import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { preferSourceConnection } from "../lib/identity-policy";
import { consumeVerificationSql, incrementVerificationAttemptSql, incrementVerificationRateSql } from "../lib/verification-queries";

function verificationDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE email_verifications (
    challenge_hash TEXT PRIMARY KEY, email_key TEXT NOT NULL, purpose TEXT NOT NULL,
    code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE verification_rate_limits (
    scope_key TEXT NOT NULL, window_start INTEGER NOT NULL, request_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE(scope_key, window_start)
  );`);
  return database;
}

test("a verification code is consumed exactly once", () => {
  const database = verificationDatabase();
  const future = Date.now() + 60_000;
  database.prepare("INSERT INTO email_verifications VALUES (?, ?, ?, ?, ?, 0)")
    .run("challenge", "person@example.com", "creator", "correct-hash", future);
  const consume = database.prepare(consumeVerificationSql);
  assert.equal(consume.get("challenge", "correct-hash", Date.now())?.email_key, "person@example.com");
  assert.equal(consume.get("challenge", "correct-hash", Date.now()), undefined);
});

test("only five incorrect verification attempts can be reserved", () => {
  const database = verificationDatabase();
  const future = Date.now() + 60_000;
  database.prepare("INSERT INTO email_verifications VALUES (?, ?, ?, ?, ?, 0)")
    .run("challenge", "person@example.com", "creator", "correct-hash", future);
  const increment = database.prepare(incrementVerificationAttemptSql);
  const attempts = Array.from({ length: 6 }, () => increment.get("challenge", Date.now())?.attempts ?? null);
  assert.deepEqual(attempts, [1, 2, 3, 4, 5, null]);
});

test("verification send counters increment atomically per scope and window", () => {
  const database = verificationDatabase();
  const increment = database.prepare(incrementVerificationRateSql);
  assert.equal(increment.get("email:create:hash", 1_000)?.request_count, 1);
  assert.equal(increment.get("email:create:hash", 1_000)?.request_count, 2);
  assert.equal(increment.get("email:create:hash", 2_000)?.request_count, 1);
});

test("profile merge keeps a usable or fresher calendar credential", () => {
  const staleDemo = { provider: "google", accountRef: "demo:old", encryptedRefreshToken: null, createdAt: 20 };
  const validOauth = { provider: "google", accountRef: "oauth:new", encryptedRefreshToken: "encrypted", createdAt: 10 };
  assert.equal(preferSourceConnection(validOauth, staleDemo), true);
  assert.equal(preferSourceConnection(staleDemo, validOauth), false);
  assert.equal(preferSourceConnection({ ...validOauth, createdAt: 30 }, validOauth), true);
});

test("the committed legacy migration upgrades participants and enforces one email per group", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE groups (id TEXT PRIMARY KEY);
    CREATE TABLE participants (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, display_name TEXT NOT NULL,
      color TEXT NOT NULL, created_at INTEGER NOT NULL
    );`);
  const migration = await readFile(new URL("../drizzle/0002_clumsy_madame_masque.sql", import.meta.url), "utf8");
  database.exec(migration.replaceAll("--> statement-breakpoint", ""));
  const columns = database.prepare("PRAGMA table_info(participants)").all().map((row) => row.name);
  assert.deepEqual(columns.slice(-4), ["email", "email_key", "email_verified_at", "is_creator"]);
  database.prepare("INSERT INTO participants VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("one", "group", "One", "blue", 1, "one@example.com", "one@example.com", 1, 0);
  assert.throws(() => database.prepare("INSERT INTO participants VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("two", "group", "Two", "blue", 2, "one@example.com", "one@example.com", 1, 0));

  const rateMigration = await readFile(new URL("../drizzle/0003_vengeful_the_fallen.sql", import.meta.url), "utf8");
  database.exec(rateMigration.replaceAll("--> statement-breakpoint", ""));
  const rateColumns = database.prepare("PRAGMA table_info(verification_rate_limits)").all().map((row) => row.name);
  assert.deepEqual(rateColumns, ["scope_key", "window_start", "request_count"]);
});
