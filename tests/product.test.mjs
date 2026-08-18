import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the Overlap product instead of starter content", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);
  assert.match(page, /Find the time/);
  assert.match(page, /Create a group/);
  assert.match(page, /Connect securely/);
  assert.match(layout, /Overlap/);
  assert.match(layout, /og\.png/);
  assert.match(css, /\.welcome-hero/);
  assert.match(packageJson, /"name": "overlap-calendar"/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("calendar integration is scoped to availability", async () => {
  const [mcp, providers, configRoute] = await Promise.all([
    readFile(new URL("lib/calendar-mcp.ts", root), "utf8"),
    readFile(new URL("lib/calendar-providers.ts", root), "utf8"),
    readFile(new URL("app/api/calendars/config/route.ts", root), "utf8"),
  ]);
  assert.match(mcp, /find_available_times/);
  assert.doesNotMatch(mcp, /get_emails|send_email|contacts/);
  assert.match(providers, /calendar\.freebusy/);
  assert.match(providers, /Calendars\.Read/);
  assert.match(providers, /@odata\.nextLink/);
  assert.match(configRoute, /providerReady\("google"\)/);
  assert.match(configRoute, /providerReady\("microsoft"\)/);
});

test("demo calendars are explicit and never a silent production fallback", async () => {
  const [connectRoute, availability, envExample] = await Promise.all([
    readFile(new URL("app/api/calendars/connect/route.ts", root), "utf8"),
    readFile(new URL("lib/availability.ts", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);
  assert.match(connectRoute, /if \(!demoCalendarsEnabled\(\)\)/);
  assert.match(connectRoute, /not configured on this deployment yet/);
  assert.match(availability, /demoEnabled && isDemoConnection\(connection\)/);
  assert.match(envExample, /ENABLE_DEMO_CALENDARS=false/);
});

test("password hashing stays within the deployed runtime limit", async () => {
  const cryptoSource = await readFile(new URL("lib/crypto.ts", root), "utf8");
  assert.match(cryptoSource, /PBKDF2_ITERATIONS = 100_000/);
  assert.doesNotMatch(cryptoSource, /iterations:\s*(?:1\d{5,}|[2-9]\d{5,})/);
});

test("calendar connection state stays visible in the connect modal", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  assert.match(page, /connectedProviders\.includes\("google"\)/);
  assert.match(page, /connectedProviders\.includes\("microsoft"\)/);
  assert.match(page, /select to reconnect or change account/);
  assert.match(page, /✓ Connected/);
});

test("one browser can retain and switch between multiple group sessions", async () => {
  const [page, serverData, groupsRoute] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("lib/server-data.ts", root), "utf8"),
    readFile(new URL("app/api/groups/route.ts", root), "utf8"),
  ]);
  assert.match(serverData, /sessionTokens/);
  assert.match(serverData, /requestedGroup/);
  assert.match(serverData, /accessibleGroups/);
  assert.match(groupsRoute, /sessionCookie\(request, result\.token\)/);
  assert.match(page, /accessibleGroups/);
  assert.match(page, /switchGroup/);
  assert.doesNotMatch(page, /onClick=\{leave\}/);
});

test("creator recovery restores the original creator and can rotate the key", async () => {
  const [page, serverData, recoveryRoute] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("lib/server-data.ts", root), "utf8"),
    readFile(new URL("app/api/groups/recovery-key/route.ts", root), "utf8"),
  ]);
  assert.match(serverData, /ORDER BY created_at ASC/);
  assert.match(serverData, /UPDATE participants SET display_name/);
  assert.match(serverData, /rotateRecoveryKey/);
  assert.match(recoveryRoute, /rotateRecoveryKey/);
  assert.match(page, /Generate a new recovery key/);
  assert.match(page, /different from the group password/i);
});

test("only creators can remove another participant", async () => {
  const [page, serverData, memberRoute] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("lib/server-data.ts", root), "utf8"),
    readFile(new URL("app/api/groups/members/[participantId]/route.ts", root), "utf8"),
  ]);
  assert.match(serverData, /removeGroupMember/);
  assert.match(serverData, /cannot remove yourself/i);
  assert.match(serverData, /DELETE FROM participants/);
  assert.match(memberRoute, /removeGroupMember/);
  assert.match(page, /Remove/);
  assert.match(page, /group\.role === "admin"/);
});

test("creators can assign participant emails and send rate-limited calendar reminders", async () => {
  const [page, serverData, memberRoute, emailSender] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("lib/server-data.ts", root), "utf8"),
    readFile(new URL("app/api/groups/members/[participantId]/route.ts", root), "utf8"),
    readFile(new URL("lib/email.ts", root), "utf8"),
  ]);
  assert.match(serverData, /assignGroupMemberEmail/);
  assert.match(serverData, /Only the group creator can add participant emails/);
  assert.match(serverData, /DELETE FROM email_verifications/);
  assert.match(serverData, /reminder:participant/);
  assert.match(serverData, /already connected a calendar/);
  assert.match(memberRoute, /export async function PUT/);
  assert.match(memberRoute, /export async function POST/);
  assert.match(emailSender, /sendCalendarReminderEmail/);
  assert.match(emailSender, /shared group password/);
  assert.match(page, /Send reminder/);
  assert.match(page, /Add participant emails/);
});

test("group access requires a short-lived verified email code", async () => {
  const [serverData, emailRoute, emailSender, schema] = await Promise.all([
    readFile(new URL("lib/server-data.ts", root), "utf8"),
    readFile(new URL("app/api/email-verification/route.ts", root), "utf8"),
    readFile(new URL("lib/email.ts", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
  ]);
  assert.match(serverData, /requestEmailVerification/);
  assert.match(serverData, /sixDigitCode/);
  assert.match(serverData, /expires_at/);
  assert.match(serverData, /verification\.attempts\) >= 5/);
  assert.match(serverData, /incrementVerificationRateSql/);
  assert.match(serverData, /consumeVerificationSql/);
  assert.match(emailRoute, /purpose/);
  assert.match(emailSender, /api\.resend\.com\/emails/);
  assert.doesNotMatch(emailSender, /EMAIL_VERIFICATION_DEBUG|debugCode/);
  assert.match(schema, /emailVerifications/);
});

test("a verified email reopens the same participant and calendar profile", async () => {
  const [serverData, page, profileRoute] = await Promise.all([
    readFile(new URL("lib/server-data.ts", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/profile/email/route.ts", root), "utf8"),
  ]);
  assert.match(serverData, /WHERE group_id = \? AND email_key = \?/);
  assert.match(serverData, /mergeParticipantInto/);
  assert.match(serverData, /UPDATE sessions SET participant_id/);
  assert.match(page, /Verify your email/);
  assert.match(page, /Email verified/);
  assert.match(profileRoute, /verifyCurrentProfileEmail/);
});

test("partial availability names missing participants and calendars can be reconnected", async () => {
  const [availability, page] = await Promise.all([
    readFile(new URL("lib/availability.ts", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);
  assert.match(availability, /pendingParticipantCount/);
  assert.match(availability, /groupParticipantIds/);
  assert.doesNotMatch(availability, /if \(pendingParticipantCount\)/);
  assert.match(page, /availability is not yet accounted for/);
  assert.match(page, /availabilities are not yet accounted for/);
  assert.match(page, /based on the availability of/);
  assert.match(page, /connectedMemberNames/);
  assert.doesNotMatch(page, /disabled=\{!googleAvailable \|\| googleConnected\}/);
  assert.doesNotMatch(page, /disabled=\{!microsoftAvailable \|\| microsoftConnected\}/);
});

test("the temporary HTTP maintenance backdoor is not shipped", async () => {
  const [serverData, envExample] = await Promise.all([
    readFile(new URL("lib/server-data.ts", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);
  assert.doesNotMatch(serverData, /MAINTENANCE_TOKEN|maintainLegacyCreator/);
  assert.doesNotMatch(envExample, /MAINTENANCE_TOKEN/);
});
