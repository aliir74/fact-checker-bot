import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS } from "./config";

export async function checkRateLimit(
  db: D1Database,
  userId: string
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds?: number }> {
  const result = await db
    .prepare(
      "SELECT COUNT(*) as count FROM daily_usage WHERE user_id = ? AND timestamp > datetime('now', '-60 seconds')"
    )
    .bind(userId)
    .first<{ count: number }>();

  const count = result?.count ?? 0;

  if (count >= RATE_LIMIT_MAX) {
    const oldest = await db
      .prepare(
        "SELECT timestamp FROM daily_usage WHERE user_id = ? AND timestamp > datetime('now', '-60 seconds') ORDER BY timestamp ASC LIMIT 1"
      )
      .bind(userId)
      .first<{ timestamp: string }>();

    let retryAfterSeconds = RATE_LIMIT_WINDOW_SECONDS;
    if (oldest) {
      const oldestTime = new Date(oldest.timestamp + "Z").getTime();
      const now = Date.now();
      const elapsed = Math.floor((now - oldestTime) / 1000);
      retryAfterSeconds = Math.max(0, RATE_LIMIT_WINDOW_SECONDS - elapsed);
    }

    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  return { allowed: true, remaining: RATE_LIMIT_MAX - count };
}

export async function recordRequest(
  db: D1Database,
  userId: string
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO daily_usage (user_id, timestamp) VALUES (?, datetime('now'))"
    )
    .bind(userId)
    .run();
}

export async function purgeOldUsage(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      "DELETE FROM daily_usage WHERE timestamp < datetime('now', '-24 hours')"
    )
    .run();

  return result.meta.changes ?? 0;
}
