export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  OPENROUTER_API_KEY: string;
  GOOGLE_FACT_CHECK_API_KEY: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}

export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const CACHE_TTL_HOURS = 24;
export const MAX_CLAIM_LENGTH = 2000;
export const MAX_IMAGES = 3;
