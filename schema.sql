CREATE TABLE IF NOT EXISTS users (
  client_id TEXT PRIMARY KEY,
  username TEXT,
  language TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_usage (
  user_id TEXT NOT NULL,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user_ts ON daily_usage (user_id, timestamp);

CREATE TABLE IF NOT EXISTS claim_cache (
  claim_hash TEXT PRIMARY KEY,
  claim_text TEXT NOT NULL,
  verdict TEXT NOT NULL,
  confidence TEXT NOT NULL,
  analysis_en TEXT,
  analysis_fa TEXT,
  sources TEXT,
  source_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);
