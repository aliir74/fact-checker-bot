import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  checkRateLimit,
  recordRequest,
  purgeOldUsage,
} from "../src/rate-limiter";

async function setupDB() {
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS users (client_id TEXT PRIMARY KEY, username TEXT, language TEXT, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)"
  );
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS daily_usage (user_id TEXT NOT NULL, timestamp TEXT NOT NULL)"
  );
  await env.DB.exec(
    "CREATE INDEX IF NOT EXISTS idx_usage_user_ts ON daily_usage (user_id, timestamp)"
  );
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS claim_cache (claim_hash TEXT PRIMARY KEY, claim_text TEXT NOT NULL, verdict TEXT NOT NULL, confidence TEXT NOT NULL, analysis_en TEXT, analysis_fa TEXT, sources TEXT, source_type TEXT NOT NULL, created_at TEXT NOT NULL)"
  );
}

describe("checkRateLimit", () => {
  beforeEach(async () => {
    await setupDB();
  });

  it("allows first check with full remaining capacity", async () => {
    const result = await checkRateLimit(env.DB, "user-1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
    expect(result.retryAfterSeconds).toBeUndefined();
  });

  it("shows remaining = 4 after one recorded request", async () => {
    await recordRequest(env.DB, "user-1b");
    const result = await checkRateLimit(env.DB, "user-1b");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("allows up to 5 requests", async () => {
    for (let i = 0; i < 5; i++) {
      await recordRequest(env.DB, "user-2");
    }

    // After 5 recorded requests, checkRateLimit should deny
    const result = await checkRateLimit(env.DB, "user-2");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("allows requests after recording fewer than 5", async () => {
    for (let i = 0; i < 3; i++) {
      await recordRequest(env.DB, "user-3");
    }

    const result = await checkRateLimit(env.DB, "user-3");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("rejects 6th request in the window", async () => {
    for (let i = 0; i < 5; i++) {
      await recordRequest(env.DB, "user-4");
    }

    const result = await checkRateLimit(env.DB, "user-4");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("returns retryAfterSeconds between 0 and 60 when rate limited", async () => {
    for (let i = 0; i < 5; i++) {
      await recordRequest(env.DB, "user-5");
    }

    const result = await checkRateLimit(env.DB, "user-5");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeDefined();
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
  });
});

describe("recordRequest", () => {
  beforeEach(async () => {
    await setupDB();
  });

  it("inserts a row into daily_usage", async () => {
    await recordRequest(env.DB, "user-6");

    const count = await env.DB
      .prepare(
        "SELECT COUNT(*) as count FROM daily_usage WHERE user_id = ?"
      )
      .bind("user-6")
      .first<{ count: number }>();

    expect(count?.count).toBe(1);
  });
});

describe("purgeOldUsage", () => {
  beforeEach(async () => {
    await setupDB();
  });

  it("deletes old rows and returns count", async () => {
    // Insert an old row (25 hours ago)
    await env.DB
      .prepare(
        "INSERT INTO daily_usage (user_id, timestamp) VALUES (?, datetime('now', '-25 hours'))"
      )
      .bind("old-user")
      .run();

    // Insert a fresh row
    await recordRequest(env.DB, "fresh-user");

    const deleted = await purgeOldUsage(env.DB);
    expect(deleted).toBe(1);

    // Fresh row should remain
    const freshCount = await env.DB
      .prepare(
        "SELECT COUNT(*) as count FROM daily_usage WHERE user_id = ?"
      )
      .bind("fresh-user")
      .first<{ count: number }>();
    expect(freshCount?.count).toBe(1);

    // Old row should be gone
    const oldCount = await env.DB
      .prepare(
        "SELECT COUNT(*) as count FROM daily_usage WHERE user_id = ?"
      )
      .bind("old-user")
      .first<{ count: number }>();
    expect(oldCount?.count).toBe(0);
  });

  it("returns 0 when nothing to purge", async () => {
    const deleted = await purgeOldUsage(env.DB);
    expect(deleted).toBe(0);
  });
});
