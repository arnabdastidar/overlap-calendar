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
