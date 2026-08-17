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
  const [mcp, providers] = await Promise.all([
    readFile(new URL("lib/calendar-mcp.ts", root), "utf8"),
    readFile(new URL("lib/calendar-providers.ts", root), "utf8"),
  ]);
  assert.match(mcp, /find_available_times/);
  assert.doesNotMatch(mcp, /get_emails|send_email|contacts/);
  assert.match(providers, /calendar\.freebusy/);
  assert.match(providers, /Calendars\.Read/);
});
