import { env } from "cloudflare:workers";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";

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
};

export const appEnv = env as unknown as AppEnv;
const SESSION_COOKIE = "overlap_session";
const SESSION_TTL = 60 * 60 * 24 * 30;
let setupPromise: Promise<void> | null = null;

function db() {
  if (!appEnv.DB) throw new Error("The database is not available.");
  return appEnv.DB;
}

export function ensureDatabase() {
  if (!setupPromise) {
    const database = db();
    setupPromise = database.batch([
      database.prepare(`CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
        admin_token_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )`),
      database.prepare(`CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL, color TEXT NOT NULL, created_at INTEGER NOT NULL
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
      database.prepare("CREATE INDEX IF NOT EXISTS idx_participants_group_id ON participants(group_id)"),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_group_id ON sessions(group_id)"),
      database.prepare("CREATE INDEX IF NOT EXISTS idx_connections_participant_id ON calendar_connections(participant_id)"),
    ]).then(() => undefined).catch((error) => {
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

export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_TTL}`;
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

export async function createGroup(input: { name: string; password: string; displayName: string }) {
  await ensureDatabase();
  const name = cleanName(input.name, "Group name");
  const displayName = cleanName(input.displayName, "Your name", 40);
  if (input.password.length < 6 || input.password.length > 100) throw new Error("Password must be between 6 and 100 characters.");

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
      db().prepare("INSERT INTO participants (id, group_id, display_name, color, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(participantId, groupId, displayName, colorFor(participantId), now),
    ]);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) throw new Error("That group name is already in use. Try a more specific name.");
    throw error;
  }
  return { token: await makeSession(groupId, participantId, "admin"), adminKey, slug };
}

export async function joinGroup(input: { group: string; password: string; displayName: string }) {
  await ensureDatabase();
  const groupLookup = cleanName(input.group, "Group name").toLowerCase();
  const displayName = cleanName(input.displayName, "Your name", 40);
  const group = await db().prepare("SELECT * FROM groups WHERE name_key = ? OR slug = ? LIMIT 1").bind(groupLookup, groupLookup).first<Record<string, unknown>>();
  if (!group || !(await verifyPassword(input.password, String(group.password_salt), String(group.password_hash)))) {
    throw new Error("Group name or password is incorrect.");
  }
  const participantId = crypto.randomUUID();
  await db().prepare("INSERT INTO participants (id, group_id, display_name, color, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(participantId, group.id, displayName, colorFor(participantId), Date.now()).run();
  return { token: await makeSession(String(group.id), participantId, "member"), slug: String(group.slug) };
}

export async function recoverGroup(input: { group: string; adminKey: string; displayName: string }) {
  await ensureDatabase();
  const groupLookup = cleanName(input.group, "Group name").toLowerCase();
  const displayName = cleanName(input.displayName, "Your name", 40);
  const group = await db().prepare("SELECT * FROM groups WHERE name_key = ? OR slug = ? LIMIT 1").bind(groupLookup, groupLookup).first<Record<string, unknown>>();
  const suppliedHash = await sha256(input.adminKey.trim());
  if (!group || suppliedHash !== String(group.admin_token_hash)) throw new Error("Group name or creator recovery key is incorrect.");
  const participantId = crypto.randomUUID();
  await db().prepare("INSERT INTO participants (id, group_id, display_name, color, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(participantId, group.id, displayName, colorFor(participantId), Date.now()).run();
  return { token: await makeSession(String(group.id), participantId, "admin"), slug: String(group.slug) };
}

export async function currentContext(request: Request) {
  await ensureDatabase();
  const token = cookieValue(request);
  if (!token) return null;
  const row = await db().prepare(`SELECT
      s.group_id AS groupId, s.participant_id AS participantId, s.role, s.expires_at AS expiresAt,
      g.name AS groupName, g.slug, p.display_name AS displayName
    FROM sessions s JOIN groups g ON g.id = s.group_id JOIN participants p ON p.id = s.participant_id
    WHERE s.token_hash = ? LIMIT 1`)
    .bind(await sha256(token)).first<Record<string, unknown>>();
  if (!row || Number(row.expiresAt) < Date.now()) return null;
  return {
    groupId: String(row.groupId), participantId: String(row.participantId),
    role: row.role === "admin" ? "admin" as const : "member" as const,
    groupName: String(row.groupName), slug: String(row.slug), displayName: String(row.displayName),
  };
}

export async function groupSnapshot(request: Request) {
  const context = await currentContext(request);
  if (!context) return null;
  const members = await db().prepare(`SELECT p.id, p.display_name AS displayName, p.color,
      c.provider, c.display_name AS calendarName
    FROM participants p LEFT JOIN calendar_connections c ON c.participant_id = p.id
    WHERE p.group_id = ? ORDER BY p.created_at ASC`)
    .bind(context.groupId).all<Record<string, unknown>>();
  return { ...context, members: members.results.map((member) => ({
    id: String(member.id), displayName: String(member.displayName), color: String(member.color),
    provider: member.provider ? String(member.provider) : null,
    calendarName: member.calendarName ? String(member.calendarName) : null,
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
}

export async function leaveGroup(request: Request) {
  const token = cookieValue(request);
  if (token) await db().prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
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
  const state = await db().prepare("SELECT * FROM oauth_states WHERE token_hash = ? AND provider = ? LIMIT 1")
    .bind(tokenHash, provider).first<Record<string, unknown>>();
  await db().prepare("DELETE FROM oauth_states WHERE token_hash = ?").bind(tokenHash).run();
  if (!state || Number(state.expires_at) < Date.now()) throw new Error("The calendar connection link expired. Please try again.");
  return { participantId: String(state.participant_id), groupId: String(state.group_id), redirectUri: String(state.redirect_uri) };
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
