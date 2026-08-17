import { env } from "cloudflare:workers";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { sendVerificationEmail } from "./email";

export type Provider = "google" | "microsoft" | "mcp";

type AppEnv = {
  DB?: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  CALENDAR_MCP_URL?: string;
  CALENDAR_MCP_API_KEY?: string;
  ENABLE_DEMO_CALENDARS?: string;
  MAINTENANCE_TOKEN?: string;
};

export const appEnv = env as unknown as AppEnv;
const SESSION_COOKIE = "overlap_session";
const SESSION_TTL = 60 * 60 * 24 * 30;
const SESSION_LIMIT = 12;
let setupPromise: Promise<void> | null = null;

type GroupContext = {
  groupId: string;
  participantId: string;
  role: "admin" | "member";
  groupName: string;
  slug: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
};

function db() {
  if (!appEnv.DB) throw new Error("The database is not available.");
  return appEnv.DB;
}

async function initializeDatabase() {
  const database = db();
  await database.batch([
      database.prepare(`CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
        admin_token_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )`),
      database.prepare(`CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL, color TEXT NOT NULL, email TEXT, email_key TEXT,
        email_verified_at INTEGER, is_creator INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      )`),
      database.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        role TEXT NOT NULL, expires_at INTEGER NOT NULL
      )`),
      database.prepare(`CREATE TABLE IF NOT EXISTS calendar_connections (
        id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        provider TEXT NOT NULL, account_ref TEXT NOT NULL, display_name TEXT NOT NULL,
        encrypted_refresh_token TEXT, created_at INTEGER NOT NULL,
        UNIQUE(participant_id, provider)
      )`),
      database.prepare(`CREATE TABLE IF NOT EXISTS oauth_states (
        token_hash TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        provider TEXT NOT NULL, redirect_uri TEXT NOT NULL, expires_at INTEGER NOT NULL
      )`),
      database.prepare(`CREATE TABLE IF NOT EXISTS email_verifications (
        challenge_hash TEXT PRIMARY KEY,
        group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
        participant_id TEXT REFERENCES participants(id) ON DELETE CASCADE,
        email_key TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      )`),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_participants_group_id ON participants(group_id)"),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_group_id ON sessions(group_id)"),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_connections_participant_id ON calendar_connections(participant_id)"),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_email_verifications_email_created ON email_verifications(email_key, created_at)"),
    ]);

  const info = await database.prepare("PRAGMA table_info(participants)").all<Record<string, unknown>>();
  const columns = new Set(info.results.map((column) => String(column.name)));
  const additions: D1PreparedStatement[] = [];
  if (!columns.has("email")) additions.push(database.prepare("ALTER TABLE participants ADD COLUMN email TEXT"));
  if (!columns.has("email_key")) additions.push(database.prepare("ALTER TABLE participants ADD COLUMN email_key TEXT"));
  if (!columns.has("email_verified_at")) additions.push(database.prepare("ALTER TABLE participants ADD COLUMN email_verified_at INTEGER"));
  if (!columns.has("is_creator")) additions.push(database.prepare("ALTER TABLE participants ADD COLUMN is_creator INTEGER NOT NULL DEFAULT 0"));
  if (additions.length) await database.batch(additions);

  await database.batch([
    database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_group_email ON participants(group_id, email_key) WHERE email_key IS NOT NULL"),
    database.prepare(`UPDATE participants SET is_creator = 1
      WHERE id IN (
        SELECT candidate.id FROM participants candidate
        WHERE candidate.id = (
          SELECT first_participant.id FROM participants first_participant
          WHERE first_participant.group_id = candidate.group_id
          ORDER BY first_participant.created_at ASC, first_participant.id ASC LIMIT 1
        )
      ) AND group_id NOT IN (SELECT group_id FROM participants WHERE is_creator = 1)`),
    database.prepare("PRAGMA optimize"),
  ]);
}

export function ensureDatabase() {
  if (!setupPromise) {
    setupPromise = initializeDatabase().catch((error) => {
      setupPromise = null;
      throw error;
    });
  }
  return setupPromise;
}

function cleanName(value: string, label: string, max = 60) {
  const result = value.trim().replace(/\s+/g, " ");
  if (result.length < 2 || result.length > max) throw new Error(`${label} must be between 2 and ${max} characters.`);
  return result;
}

function cleanEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  return email;
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
}

function colorFor(id: string) {
  const colors = ["coral", "blue", "gold", "ink", "sage", "plum"];
  return colors[Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length];
}

function cookieValue(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function sessionTokens(request: Request) {
  const value = cookieValue(request);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((token): token is string => typeof token === "string" && token.length > 20).slice(-SESSION_LIMIT);
  } catch {
    // Older deployments stored one token directly.
  }
  return value.length > 20 ? [value] : [];
}

export function sessionCookie(request: Request, token: string) {
  const tokens = [...sessionTokens(request).filter((item) => item !== token), token].slice(-SESSION_LIMIT);
  return `${SESSION_COOKIE}=${encodeURIComponent(JSON.stringify(tokens))}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_TTL}`;
}

export function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

async function makeSession(groupId: string, participantId: string, role: "admin" | "member") {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = Date.now() + SESSION_TTL * 1000;
  await db().prepare("INSERT INTO sessions (token_hash, group_id, participant_id, role, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(tokenHash, groupId, participantId, role, expiresAt).run();
  return token;
}

type VerificationPurpose = "create" | "join" | "creator" | "profile";

async function findGroup(value: string) {
  const groupLookup = cleanName(value, "Group name").toLowerCase();
  return db().prepare("SELECT * FROM groups WHERE name_key = ? OR slug = ? LIMIT 1")
    .bind(groupLookup, groupLookup).first<Record<string, unknown>>();
}

async function verifiedGroup(value: string, password: string) {
  const group = await findGroup(value);
  if (!group || !(await verifyPassword(password, String(group.password_salt), String(group.password_hash)))) {
    throw new Error("Group name or password is incorrect.");
  }
  return group;
}

function sixDigitCode() {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return String(100000 + (random[0] % 900000));
}

export async function requestEmailVerification(request: Request, input: {
  purpose: VerificationPurpose;
  email: string;
  group?: string;
  password?: string;
}) {
  await ensureDatabase();
  const email = cleanEmail(input.email);
  let group: Record<string, unknown> | null = null;
  let participantId: string | null = null;

  if (input.purpose === "create") {
    const name = cleanName(input.group ?? "", "Group name");
    const slug = slugify(name);
    const existing = await db().prepare("SELECT id FROM groups WHERE name_key = ? OR slug = ? LIMIT 1")
      .bind(name.toLowerCase(), slug).first();
    if (existing) throw new Error("That group name is already in use. Try a more specific name.");
  } else if (input.purpose === "join") {
    group = await verifiedGroup(input.group ?? "", input.password ?? "");
  } else if (input.purpose === "creator") {
    group = await findGroup(input.group ?? "");
    const creator = group ? await db().prepare(`SELECT id FROM participants
      WHERE group_id = ? AND is_creator = 1 AND email_key = ? LIMIT 1`)
      .bind(group.id, email).first<Record<string, unknown>>() : null;
    if (!group || !creator) {
      return { challenge: randomToken(24), expiresIn: 600 };
    }
    participantId = String(creator.id);
  } else {
    const context = await currentContext(request);
    if (!context) throw new Error("Join a group before verifying this profile.");
    group = await db().prepare("SELECT * FROM groups WHERE id = ? LIMIT 1").bind(context.groupId).first<Record<string, unknown>>();
    participantId = context.participantId;
  }

  await db().prepare("DELETE FROM email_verifications WHERE expires_at < ?").bind(Date.now()).run();
  const recent = await db().prepare(`SELECT COUNT(*) AS count FROM email_verifications
    WHERE email_key = ? AND created_at > ?`).bind(email, Date.now() - 10 * 60 * 1000).first<Record<string, unknown>>();
  if (Number(recent?.count ?? 0) >= 3) throw new Error("Too many codes were requested. Please wait 10 minutes and try again.");

  const challenge = randomToken(24);
  const challengeHash = await sha256(challenge);
  const code = sixDigitCode();
  const now = Date.now();
  await db().prepare(`INSERT INTO email_verifications
    (challenge_hash, group_id, participant_id, email_key, purpose, code_hash, expires_at, attempts, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`)
    .bind(challengeHash, group?.id ?? null, participantId, email, input.purpose, await sha256(`${challenge}:${code}`), now + 10 * 60 * 1000, now).run();
  try {
    const sent = await sendVerificationEmail({
      email, code, groupName: group ? String(group.name) : input.group?.trim(), idempotencyKey: challengeHash,
    });
    return { challenge, expiresIn: 600, ...sent };
  } catch (error) {
    await db().prepare("DELETE FROM email_verifications WHERE challenge_hash = ?").bind(challengeHash).run();
    throw error;
  }
}

async function consumeEmailVerification(input: {
  purpose: VerificationPurpose;
  email: string;
  challenge: string;
  code: string;
  groupId?: string | null;
  participantId?: string | null;
}) {
  const email = cleanEmail(input.email);
  const challengeHash = await sha256(input.challenge);
  const verification = await db().prepare("SELECT * FROM email_verifications WHERE challenge_hash = ? LIMIT 1")
    .bind(challengeHash).first<Record<string, unknown>>();
  if (!verification || String(verification.purpose) !== input.purpose || String(verification.email_key) !== email
    || (input.groupId !== undefined && String(verification.group_id ?? "") !== String(input.groupId ?? ""))
    || (input.participantId !== undefined && String(verification.participant_id ?? "") !== String(input.participantId ?? ""))) {
    throw new Error("That verification code is invalid or has expired.");
  }
  if (Number(verification.expires_at) < Date.now() || Number(verification.attempts) >= 5) {
    await db().prepare("DELETE FROM email_verifications WHERE challenge_hash = ?").bind(challengeHash).run();
    throw new Error("That verification code is invalid or has expired.");
  }
  const expected = String(verification.code_hash);
  const supplied = await sha256(`${input.challenge}:${input.code.trim()}`);
  if (supplied !== expected) {
    await db().prepare("UPDATE email_verifications SET attempts = attempts + 1 WHERE challenge_hash = ?").bind(challengeHash).run();
    throw new Error("That verification code is incorrect.");
  }
  await db().prepare("DELETE FROM email_verifications WHERE challenge_hash = ?").bind(challengeHash).run();
  return email;
}

export async function createGroup(input: { name: string; password: string; displayName: string; email: string; challenge: string; code: string }) {
  await ensureDatabase();
  const name = cleanName(input.name, "Group name");
  const displayName = cleanName(input.displayName, "Your name", 40);
  if (input.password.length < 6 || input.password.length > 100) throw new Error("Password must be between 6 and 100 characters.");
  const email = await consumeEmailVerification({ purpose: "create", email: input.email, challenge: input.challenge, code: input.code });

  const groupId = crypto.randomUUID();
  const participantId = crypto.randomUUID();
  const adminKey = randomToken(20);
  const { hash, salt } = await hashPassword(input.password);
  const now = Date.now();
  const slug = slugify(name);
  if (!slug) throw new Error("Group name needs at least one letter or number.");

  try {
    await db().batch([
      db().prepare(`INSERT INTO groups
        (id, name, name_key, slug, password_hash, password_salt, admin_token_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(groupId, name, name.toLowerCase(), slug, hash, salt, await sha256(adminKey), now, now),
      db().prepare(`INSERT INTO participants
        (id, group_id, display_name, color, email, email_key, email_verified_at, is_creator, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`).bind(participantId, groupId, displayName, colorFor(participantId), email, email, now, now),
    ]);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) throw new Error("That group name is already in use. Try a more specific name.");
    throw error;
  }
  return { token: await makeSession(groupId, participantId, "admin"), adminKey, slug };
}

export async function joinGroup(input: { group: string; password: string; displayName: string; email: string; challenge: string; code: string }) {
  await ensureDatabase();
  const displayName = cleanName(input.displayName, "Your name", 40);
  const group = await verifiedGroup(input.group, input.password);
  const email = await consumeEmailVerification({ purpose: "join", email: input.email, challenge: input.challenge, code: input.code, groupId: String(group.id) });
  const existing = await db().prepare("SELECT id, is_creator FROM participants WHERE group_id = ? AND email_key = ? LIMIT 1")
    .bind(group.id, email).first<Record<string, unknown>>();
  const participantId = existing ? String(existing.id) : crypto.randomUUID();
  const now = Date.now();
  if (existing) {
    await db().prepare("UPDATE participants SET display_name = ?, email = ?, email_verified_at = ? WHERE id = ?")
      .bind(displayName, email, now, participantId).run();
  } else {
    await db().prepare(`INSERT INTO participants
      (id, group_id, display_name, color, email, email_key, email_verified_at, is_creator, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`).bind(participantId, group.id, displayName, colorFor(participantId), email, email, now, now).run();
  }
  const role = Number(existing?.is_creator ?? 0) === 1 ? "admin" : "member";
  return { token: await makeSession(String(group.id), participantId, role), slug: String(group.slug) };
}

export async function recoverGroup(input: { group: string; adminKey: string; displayName: string }) {
  await ensureDatabase();
  const displayName = cleanName(input.displayName, "Your name", 40);
  const group = await findGroup(input.group);
  const suppliedHash = await sha256(input.adminKey.trim());
  if (!group || suppliedHash !== String(group.admin_token_hash)) throw new Error("Group name or creator recovery key is incorrect.");
  const creator = await db().prepare("SELECT id FROM participants WHERE group_id = ? AND is_creator = 1 ORDER BY created_at ASC, id ASC LIMIT 1")
    .bind(group.id).first<Record<string, unknown>>();
  if (!creator) throw new Error("The creator profile for this group is missing.");
  const participantId = String(creator.id);
  await db().prepare("UPDATE participants SET display_name = ? WHERE id = ? AND group_id = ?")
    .bind(displayName, participantId, group.id).run();
  return { token: await makeSession(String(group.id), participantId, "admin"), slug: String(group.slug) };
}

export async function recoverGroupByEmail(input: { group: string; displayName: string; email: string; challenge: string; code: string }) {
  await ensureDatabase();
  const group = await findGroup(input.group);
  if (!group) throw new Error("That verification code is invalid or has expired.");
  const displayName = cleanName(input.displayName, "Your name", 40);
  const email = await consumeEmailVerification({ purpose: "creator", email: input.email, challenge: input.challenge, code: input.code, groupId: String(group.id) });
  const creator = await db().prepare("SELECT id FROM participants WHERE group_id = ? AND is_creator = 1 AND email_key = ? LIMIT 1")
    .bind(group.id, email).first<Record<string, unknown>>();
  if (!creator) throw new Error("That verification code is invalid or has expired.");
  const participantId = String(creator.id);
  await db().prepare("UPDATE participants SET display_name = ?, email = ?, email_verified_at = ? WHERE id = ?")
    .bind(displayName, email, Date.now(), participantId).run();
  return { token: await makeSession(String(group.id), participantId, "admin"), slug: String(group.slug) };
}

function requestedGroup(request: Request) {
  const url = new URL(request.url);
  const value = url.searchParams.has("group") ? url.searchParams.get("group") : request.headers.get("x-overlap-group");
  return value?.trim().toLowerCase() || null;
}

async function sessionContexts(request: Request) {
  await ensureDatabase();
      const rows = await Promise.all(sessionTokens(request).map(async (token) => db().prepare(`SELECT
        s.group_id AS groupId, s.participant_id AS participantId, s.role, s.expires_at AS expiresAt,
        g.name AS groupName, g.slug, p.display_name AS displayName, p.email,
        p.email_verified_at AS emailVerifiedAt, p.is_creator AS isCreator
      FROM sessions s JOIN groups g ON g.id = s.group_id JOIN participants p ON p.id = s.participant_id
      WHERE s.token_hash = ? LIMIT 1`)
    .bind(await sha256(token)).first<Record<string, unknown>>()));
  const contexts = new Map<string, GroupContext>();
  rows.forEach((row) => {
    if (!row || Number(row.expiresAt) < Date.now()) return;
    const context: GroupContext = {
      groupId: String(row.groupId), participantId: String(row.participantId),
      role: row.role === "admin" || Number(row.isCreator) === 1 ? "admin" : "member",
      groupName: String(row.groupName), slug: String(row.slug), displayName: String(row.displayName),
      email: row.email ? String(row.email) : null, emailVerified: Number(row.emailVerifiedAt ?? 0) > 0,
    };
    const existing = contexts.get(context.slug);
    if (!existing || context.role === "admin") contexts.set(context.slug, context);
  });
  return [...contexts.values()];
}

export async function currentContext(request: Request) {
  const contexts = await sessionContexts(request);
  const requested = requestedGroup(request);
  return requested ? contexts.find((context) => context.slug === requested) ?? null : contexts.at(-1) ?? null;
}

export async function groupSnapshot(request: Request) {
  const contexts = await sessionContexts(request);
  const requested = requestedGroup(request);
  const context = (requested ? contexts.find((item) => item.slug === requested) : null) ?? contexts.at(-1) ?? null;
  if (!context) return null;
  const members = await db().prepare(`SELECT p.id, p.display_name AS displayName, p.color,
      p.email_verified_at AS emailVerifiedAt, p.is_creator AS isCreator,
      c.provider, c.display_name AS calendarName, c.account_ref AS accountRef
    FROM participants p LEFT JOIN calendar_connections c ON c.participant_id = p.id
    WHERE p.group_id = ? ORDER BY p.created_at ASC`)
    .bind(context.groupId).all<Record<string, unknown>>();
  return { ...context, accessibleGroups: contexts.map((item) => ({
    groupName: item.groupName, slug: item.slug, role: item.role, participantId: item.participantId,
  })), members: members.results.map((member) => ({
    id: String(member.id), displayName: String(member.displayName), color: String(member.color),
    emailVerified: Number(member.emailVerifiedAt ?? 0) > 0, isCreator: Number(member.isCreator ?? 0) === 1,
    provider: member.provider ? String(member.provider) : null,
    calendarName: member.calendarName ? String(member.calendarName) : null,
    isDemo: (member.provider === "google" || member.provider === "microsoft")
      && Boolean(member.accountRef && String(member.accountRef).startsWith("demo:")),
  })) };
}

export async function updateGroup(request: Request, input: { name?: string; password?: string }) {
  const context = await currentContext(request);
  if (!context || context.role !== "admin") throw new Error("Only the group creator can change these settings.");
  if (!input.name && !input.password) throw new Error("Add a new group name or password.");
  if (input.name) {
    const name = cleanName(input.name, "Group name");
    const slug = slugify(name);
    try {
      await db().prepare("UPDATE groups SET name = ?, name_key = ?, slug = ?, updated_at = ? WHERE id = ?")
        .bind(name, name.toLowerCase(), slug, Date.now(), context.groupId).run();
    } catch (error) {
      if (String(error).toLowerCase().includes("unique")) throw new Error("That group name is already in use.");
      throw error;
    }
  }
  if (input.password) {
    if (input.password.length < 6 || input.password.length > 100) throw new Error("Password must be between 6 and 100 characters.");
    const { hash, salt } = await hashPassword(input.password);
    await db().prepare("UPDATE groups SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?")
      .bind(hash, salt, Date.now(), context.groupId).run();
  }
  const updated = await db().prepare("SELECT slug FROM groups WHERE id = ? LIMIT 1").bind(context.groupId).first<Record<string, unknown>>();
  return { slug: String(updated?.slug ?? context.slug) };
}

export async function rotateRecoveryKey(request: Request) {
  const context = await currentContext(request);
  if (!context || context.role !== "admin") throw new Error("Only the group creator can generate a recovery key.");
  const adminKey = randomToken(20);
  await db().prepare("UPDATE groups SET admin_token_hash = ?, updated_at = ? WHERE id = ?")
    .bind(await sha256(adminKey), Date.now(), context.groupId).run();
  return adminKey;
}

export async function removeGroupMember(request: Request, participantId: string) {
  const context = await currentContext(request);
  if (!context || context.role !== "admin") throw new Error("Only the group creator can remove people.");
  if (participantId === context.participantId) throw new Error("You cannot remove yourself from a group you created.");
  const participant = await db().prepare("SELECT id, is_creator FROM participants WHERE id = ? AND group_id = ? LIMIT 1")
    .bind(participantId, context.groupId).first<Record<string, unknown>>();
  if (!participant) throw new Error("That person is no longer in this group.");
  if (Number(participant.is_creator) === 1) throw new Error("The creator profile cannot be removed.");
  await db().batch([
    db().prepare("DELETE FROM oauth_states WHERE participant_id = ?").bind(participantId),
    db().prepare("DELETE FROM calendar_connections WHERE participant_id = ?").bind(participantId),
    db().prepare("DELETE FROM sessions WHERE participant_id = ?").bind(participantId),
    db().prepare("DELETE FROM participants WHERE id = ? AND group_id = ?").bind(participantId, context.groupId),
  ]);
}

async function mergeParticipantInto(groupId: string, sourceId: string, targetId: string) {
  if (sourceId === targetId) return;
  const people = await db().prepare("SELECT id, is_creator FROM participants WHERE group_id = ? AND id IN (?, ?)")
    .bind(groupId, sourceId, targetId).all<Record<string, unknown>>();
  if (people.results.length !== 2) throw new Error("One of the profiles to merge no longer exists.");
  const source = people.results.find((person) => String(person.id) === sourceId);
  const target = people.results.find((person) => String(person.id) === targetId);
  const isCreator = Number(source?.is_creator ?? 0) === 1 || Number(target?.is_creator ?? 0) === 1;
  const sourceConnections = await db().prepare("SELECT id, provider FROM calendar_connections WHERE participant_id = ?")
    .bind(sourceId).all<Record<string, unknown>>();
  for (const connection of sourceConnections.results) {
    const existing = await db().prepare("SELECT id FROM calendar_connections WHERE participant_id = ? AND provider = ? LIMIT 1")
      .bind(targetId, connection.provider).first<Record<string, unknown>>();
    if (existing) {
      await db().prepare("DELETE FROM calendar_connections WHERE id = ?").bind(connection.id).run();
    } else {
      await db().prepare("UPDATE calendar_connections SET participant_id = ? WHERE id = ?").bind(targetId, connection.id).run();
    }
  }
  await db().batch([
    db().prepare("UPDATE oauth_states SET participant_id = ? WHERE participant_id = ?").bind(targetId, sourceId),
    db().prepare("UPDATE sessions SET participant_id = ?, role = ? WHERE participant_id = ?").bind(targetId, isCreator ? "admin" : "member", sourceId),
    db().prepare("UPDATE participants SET is_creator = ? WHERE id = ?").bind(isCreator ? 1 : 0, targetId),
    db().prepare("DELETE FROM participants WHERE id = ? AND group_id = ?").bind(sourceId, groupId),
  ]);
  if (isCreator) await db().prepare("UPDATE sessions SET role = 'admin' WHERE participant_id = ?").bind(targetId).run();
}

export async function verifyCurrentProfileEmail(request: Request, input: { email: string; challenge: string; code: string }) {
  const context = await currentContext(request);
  if (!context) throw new Error("Join a group before verifying this profile.");
  const email = await consumeEmailVerification({
    purpose: "profile", email: input.email, challenge: input.challenge, code: input.code,
    groupId: context.groupId, participantId: context.participantId,
  });
  const existing = await db().prepare("SELECT id FROM participants WHERE group_id = ? AND email_key = ? LIMIT 1")
    .bind(context.groupId, email).first<Record<string, unknown>>();
  const now = Date.now();
  if (existing && String(existing.id) !== context.participantId) {
    await db().prepare("UPDATE participants SET email = ?, email_key = ?, email_verified_at = ? WHERE id = ?")
      .bind(email, email, now, existing.id).run();
    await mergeParticipantInto(context.groupId, context.participantId, String(existing.id));
    return { merged: true };
  }
  await db().prepare("UPDATE participants SET email = ?, email_key = ?, email_verified_at = ? WHERE id = ? AND group_id = ?")
    .bind(email, email, now, context.participantId, context.groupId).run();
  return { merged: false };
}

export async function maintainLegacyCreator(request: Request, input: { group: string; email: string; mergeDisplayName?: string }) {
  await ensureDatabase();
  const authorization = request.headers.get("authorization") ?? "";
  if (!appEnv.MAINTENANCE_TOKEN || authorization !== `Bearer ${appEnv.MAINTENANCE_TOKEN}`) throw new Error("Maintenance access denied.");
  const group = await findGroup(input.group);
  if (!group) throw new Error("Group not found.");
  const creator = await db().prepare("SELECT id FROM participants WHERE group_id = ? AND is_creator = 1 ORDER BY created_at ASC, id ASC LIMIT 1")
    .bind(group.id).first<Record<string, unknown>>();
  if (!creator) throw new Error("Creator profile not found.");
  const email = cleanEmail(input.email);
  await db().prepare("UPDATE participants SET email = ?, email_key = ?, is_creator = 1 WHERE id = ?")
    .bind(email, email, creator.id).run();
  let merged = 0;
  if (input.mergeDisplayName?.trim()) {
    const duplicates = await db().prepare(`SELECT id FROM participants
      WHERE group_id = ? AND id != ? AND lower(display_name) = lower(?) ORDER BY created_at ASC`)
      .bind(group.id, creator.id, input.mergeDisplayName.trim()).all<Record<string, unknown>>();
    for (const duplicate of duplicates.results) {
      await mergeParticipantInto(String(group.id), String(duplicate.id), String(creator.id));
      merged += 1;
    }
  }
  await db().prepare("UPDATE sessions SET role = 'admin' WHERE participant_id = ?").bind(creator.id).run();
  return { slug: String(group.slug), creatorParticipantId: String(creator.id), merged };
}

export async function leaveGroup(request: Request) {
  const tokens = sessionTokens(request);
  if (tokens.length) await db().batch(await Promise.all(tokens.map(async (token) => db().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)))));
}

export async function saveOAuthState(context: NonNullable<Awaited<ReturnType<typeof currentContext>>>, provider: "google" | "microsoft", redirectUri: string) {
  const token = randomToken();
  await db().prepare("INSERT INTO oauth_states (token_hash, group_id, participant_id, provider, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256(token), context.groupId, context.participantId, provider, redirectUri, Date.now() + 10 * 60 * 1000).run();
  return token;
}

export async function consumeOAuthState(token: string, provider: "google" | "microsoft") {
  await ensureDatabase();
  const tokenHash = await sha256(token);
  const state = await db().prepare(`SELECT o.*, g.slug FROM oauth_states o
      JOIN groups g ON g.id = o.group_id WHERE o.token_hash = ? AND o.provider = ? LIMIT 1`)
    .bind(tokenHash, provider).first<Record<string, unknown>>();
  await db().prepare("DELETE FROM oauth_states WHERE token_hash = ?").bind(tokenHash).run();
  if (!state || Number(state.expires_at) < Date.now()) throw new Error("The calendar connection link expired. Please try again.");
  return { participantId: String(state.participant_id), groupId: String(state.group_id), slug: String(state.slug), redirectUri: String(state.redirect_uri) };
}

export async function upsertConnection(input: { participantId: string; provider: Provider; accountRef: string; displayName: string; encryptedRefreshToken?: string | null }) {
  await ensureDatabase();
  await db().prepare(`INSERT INTO calendar_connections
      (id, participant_id, provider, account_ref, display_name, encrypted_refresh_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(participant_id, provider) DO UPDATE SET
        account_ref = excluded.account_ref, display_name = excluded.display_name,
        encrypted_refresh_token = excluded.encrypted_refresh_token`)
    .bind(crypto.randomUUID(), input.participantId, input.provider, input.accountRef, input.displayName, input.encryptedRefreshToken ?? null, Date.now()).run();
}

export async function updateConnectionRefreshToken(connectionId: string, encryptedRefreshToken: string) {
  await ensureDatabase();
  await db().prepare("UPDATE calendar_connections SET encrypted_refresh_token = ? WHERE id = ?")
    .bind(encryptedRefreshToken, connectionId).run();
}

export async function groupConnections(groupId: string) {
  await ensureDatabase();
  const result = await db().prepare(`SELECT c.* FROM calendar_connections c
    JOIN participants p ON p.id = c.participant_id WHERE p.group_id = ?`).bind(groupId).all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: String(row.id), participantId: String(row.participant_id), provider: String(row.provider) as Provider,
    accountRef: String(row.account_ref), displayName: String(row.display_name),
    encryptedRefreshToken: row.encrypted_refresh_token ? String(row.encrypted_refresh_token) : null,
  }));
}
