import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  normalizeForHash,
  hashClaim,
  getCachedClaim,
  setCachedClaim,
  purgeExpiredCache,
  upsertUser,
} from "../src/cache";
import { CachedClaim } from "../src/types";

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

describe("normalizeForHash", () => {
  it("lowercases text", () => {
    expect(normalizeForHash("HELLO WORLD")).toBe("hello world");
  });

  it("trims whitespace", () => {
    expect(normalizeForHash("  hello  ")).toBe("hello");
  });

  it("strips punctuation", () => {
    expect(normalizeForHash("hello, world! How's it?")).toBe(
      "hello world hows it"
    );
  });

  it("collapses multiple whitespace to single space", () => {
    expect(normalizeForHash("hello   world   test")).toBe("hello world test");
  });

  it("handles combined transformations", () => {
    expect(normalizeForHash("  Hello, World!  How's  IT?  ")).toBe(
      "hello world hows it"
    );
  });
});

describe("hashClaim", () => {
  it("produces consistent SHA-256 hex for same input", async () => {
    const hash1 = await hashClaim("the earth is flat");
    const hash2 = await hashClaim("the earth is flat");
    expect(hash1).toBe(hash2);
  });

  it("produces a 64-character hex string", async () => {
    const hash = await hashClaim("test claim");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes before hashing so equivalent texts match", async () => {
    const hash1 = await hashClaim("Hello, World!");
    const hash2 = await hashClaim("  hello  world  ");
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different claims", async () => {
    const hash1 = await hashClaim("the earth is flat");
    const hash2 = await hashClaim("the earth is round");
    expect(hash1).not.toBe(hash2);
  });
});

describe("getCachedClaim", () => {
  beforeEach(async () => {
    await setupDB();
  });

  it("returns null for missing hash", async () => {
    const result = await getCachedClaim(env.DB, "nonexistent-hash");
    expect(result).toBeNull();
  });

  it("returns null for expired entry", async () => {
    await env.DB
      .prepare(
        "INSERT INTO claim_cache (claim_hash, claim_text, verdict, confidence, analysis_en, analysis_fa, sources, source_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-25 hours'))"
      )
      .bind(
        "expired-hash",
        "old claim",
        "True",
        "High",
        "analysis",
        null,
        null,
        "ai_analysis"
      )
      .run();

    const result = await getCachedClaim(env.DB, "expired-hash");
    expect(result).toBeNull();
  });
});

describe("setCachedClaim + getCachedClaim round-trip", () => {
  beforeEach(async () => {
    await setupDB();
  });

  it("stores and retrieves a claim correctly", async () => {
    const claim: CachedClaim = {
      claim_hash: "test-hash-123",
      claim_text: "the earth is round",
      verdict: "True",
      confidence: "High",
      analysis_en: "Scientific consensus confirms this.",
      analysis_fa: null,
      sources: JSON.stringify(["https://nasa.gov"]),
      source_type: "fact_check_api",
      created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    };

    await setCachedClaim(env.DB, claim);
    const retrieved = await getCachedClaim(env.DB, "test-hash-123");

    expect(retrieved).not.toBeNull();
    expect(retrieved!.claim_hash).toBe(claim.claim_hash);
    expect(retrieved!.claim_text).toBe(claim.claim_text);
    expect(retrieved!.verdict).toBe(claim.verdict);
    expect(retrieved!.confidence).toBe(claim.confidence);
    expect(retrieved!.analysis_en).toBe(claim.analysis_en);
    expect(retrieved!.analysis_fa).toBeNull();
    expect(retrieved!.sources).toBe(claim.sources);
    expect(retrieved!.source_type).toBe(claim.source_type);
  });

  it("replaces an existing claim with same hash", async () => {
    const claim1: CachedClaim = {
      claim_hash: "replace-hash",
      claim_text: "original text",
      verdict: "False",
      confidence: "Low",
      analysis_en: "original analysis",
      analysis_fa: null,
      sources: null,
      source_type: "ai_analysis",
      created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    };

    const claim2: CachedClaim = {
      ...claim1,
      claim_text: "updated text",
      verdict: "True",
      confidence: "High",
    };

    await setCachedClaim(env.DB, claim1);
    await setCachedClaim(env.DB, claim2);

    const retrieved = await getCachedClaim(env.DB, "replace-hash");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.claim_text).toBe("updated text");
    expect(retrieved!.verdict).toBe("True");
  });
});

describe("purgeExpiredCache", () => {
  beforeEach(async () => {
    await setupDB();
  });

  it("deletes expired rows and returns count", async () => {
    // Insert an expired row
    await env.DB
      .prepare(
        "INSERT INTO claim_cache (claim_hash, claim_text, verdict, confidence, source_type, created_at) VALUES (?, ?, ?, ?, ?, datetime('now', '-25 hours'))"
      )
      .bind("old-hash", "old claim", "True", "High", "ai_analysis")
      .run();

    // Insert a fresh row
    await env.DB
      .prepare(
        "INSERT INTO claim_cache (claim_hash, claim_text, verdict, confidence, source_type, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
      )
      .bind("fresh-hash", "fresh claim", "False", "Low", "ai_analysis")
      .run();

    const deleted = await purgeExpiredCache(env.DB);
    expect(deleted).toBe(1);

    // Fresh row should still exist
    const fresh = await env.DB
      .prepare("SELECT * FROM claim_cache WHERE claim_hash = ?")
      .bind("fresh-hash")
      .first();
    expect(fresh).not.toBeNull();

    // Old row should be gone
    const old = await env.DB
      .prepare("SELECT * FROM claim_cache WHERE claim_hash = ?")
      .bind("old-hash")
      .first();
    expect(old).toBeNull();
  });

  it("returns 0 when nothing to purge", async () => {
    const deleted = await purgeExpiredCache(env.DB);
    expect(deleted).toBe(0);
  });
});

describe("upsertUser", () => {
  beforeEach(async () => {
    await setupDB();
  });

  it("creates a new user", async () => {
    await upsertUser(env.DB, "user-1", "alice");

    const user = await env.DB
      .prepare("SELECT * FROM users WHERE client_id = ?")
      .bind("user-1")
      .first();

    expect(user).not.toBeNull();
    expect(user!.client_id).toBe("user-1");
    expect(user!.username).toBe("alice");
    expect(user!.created_at).toBeTruthy();
    expect(user!.last_seen_at).toBeTruthy();
  });

  it("creates a user without username", async () => {
    await upsertUser(env.DB, "user-2");

    const user = await env.DB
      .prepare("SELECT * FROM users WHERE client_id = ?")
      .bind("user-2")
      .first();

    expect(user).not.toBeNull();
    expect(user!.username).toBeNull();
  });

  it("updates existing user last_seen_at and username", async () => {
    await upsertUser(env.DB, "user-3", "bob");

    const firstUser = await env.DB
      .prepare("SELECT * FROM users WHERE client_id = ?")
      .bind("user-3")
      .first<{ created_at: string; last_seen_at: string }>();

    // Upsert again with new username
    await upsertUser(env.DB, "user-3", "bobby");

    const updatedUser = await env.DB
      .prepare("SELECT * FROM users WHERE client_id = ?")
      .bind("user-3")
      .first<{ created_at: string; last_seen_at: string; username: string }>();

    expect(updatedUser).not.toBeNull();
    expect(updatedUser!.username).toBe("bobby");
    // created_at should remain the same
    expect(updatedUser!.created_at).toBe(firstUser!.created_at);

    // Should still be only one row
    const count = await env.DB
      .prepare("SELECT COUNT(*) as count FROM users")
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });
});
