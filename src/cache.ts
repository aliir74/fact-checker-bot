import * as Sentry from "@sentry/cloudflare";
import { CachedClaim } from "./types";

export function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");
}

export async function hashClaim(text: string): Promise<string> {
  const normalized = normalizeForHash(text);
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getCachedClaim(
  db: D1Database,
  claimHash: string
): Promise<CachedClaim | null> {
  const row = await db
    .prepare(
      "SELECT * FROM claim_cache WHERE claim_hash = ? AND created_at > datetime('now', '-24 hours')"
    )
    .bind(claimHash)
    .first<CachedClaim>();

  Sentry.addBreadcrumb({
    category: "cache",
    message: row ? "Cache hit for claim" : "Cache miss for claim",
    level: "info",
  });

  return row ?? null;
}

export async function setCachedClaim(
  db: D1Database,
  claim: CachedClaim
): Promise<void> {
  await db
    .prepare(
      "INSERT OR REPLACE INTO claim_cache (claim_hash, claim_text, verdict, confidence, analysis_en, analysis_fa, sources, source_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      claim.claim_hash,
      claim.claim_text,
      claim.verdict,
      claim.confidence,
      claim.analysis_en,
      claim.analysis_fa,
      claim.sources,
      claim.source_type,
      claim.created_at
    )
    .run();
}

export async function purgeExpiredCache(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      "DELETE FROM claim_cache WHERE created_at < datetime('now', '-24 hours')"
    )
    .run();

  return result.meta.changes ?? 0;
}

export async function upsertUser(
  db: D1Database,
  clientId: string,
  username?: string
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO users (client_id, username, created_at, last_seen_at) VALUES (?, ?, datetime('now'), datetime('now')) ON CONFLICT(client_id) DO UPDATE SET last_seen_at = datetime('now'), username = excluded.username"
    )
    .bind(clientId, username ?? null)
    .run();
}
