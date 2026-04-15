# Fact-Checker Telegram Bot — Design Spec

**Date:** 2026-04-14
**Status:** Approved

## Overview

A public Telegram bot that fact-checks social media claims. Users send a claim (text, screenshot, or URL) and receive a bilingual (original language + Persian) verdict with confidence level, explanation, and sources.

**Phase 1:** Public bot — anyone can message it directly.
**Phase 2 (future):** Group mode — added to Telegram groups to respond to replies or mentions.

## Stack

- **Runtime:** Cloudflare Workers (TypeScript)
- **Storage:** Cloudflare D1 (SQLite)
- **LLM:** OpenRouter — Gemini with Google Search web grounding for analysis, vision model for OCR
- **Fact-check lookup:** Google Fact Check Tools API (free, 10K req/day)
- **Telegram integration:** Webhook mode (Telegram pushes updates to Worker URL)
- **Deployment:** `wrangler deploy` + GitHub Actions on push to `main`

## Architecture

```
Telegram (webhook)
  → Cloudflare Worker (entry point)
    → Input Parser (text / image / URL)
      → [if image] Vision LLM → extract claim text
      → [if URL] fetch page/tweet → extract claim text
    → Claim Cache check (D1, 24h TTL)
      → [if cached] return cached verdict (no rate limit cost)
    → Rate Limiter check (D1, per-user, 5/min)
    → Google Fact Check API (existing verdicts?)
      → [if found] format existing verdict + sources
      → [if not found] OpenRouter (Gemini w/ web grounding)
        → verdict + explanation + sources
    → Response Formatter (bilingual: claim language + Persian)
    → Cache verdict in D1
    → Send reply to Telegram
```

## Input Processing

Three input handlers, all normalizing to a claim string.

### Text messages

- Direct passthrough — the message text IS the claim.
- If the text contains a URL mixed with other text, extract the URL separately and process both.

### Image/screenshot messages

- Send the image to a vision-capable model via OpenRouter (Gemini Flash or Claude Haiku).
- Prompt: "Extract all text from this image exactly as written. If it's a social media post screenshot, include the author name and post text."
- The extracted text becomes the claim string.
- If the image has a caption, include it as additional context.
- **Multiple images:** Process the first three. Reply includes "Processing 3 of N images" if more are sent.

### URL messages

- **Tweet/X links** (`twitter.com`, `x.com`): Use `fxtwitter.com` or `vxtwitter.com` API (free, returns tweet JSON with text, author, media).
- **Other URLs:** Fetch the page, extract main content (strip HTML to readable text).
- The extracted content becomes the claim, with the URL preserved as source context.

### Rejected input

- Voice, video, sticker messages → reply: "Please send text, a screenshot, or a link."
- Text > 2000 chars → truncate with notice.

## Fact-Checking Pipeline

### Step 1 — Claim Cache (D1)

- Hash the normalized claim text (SHA-256) → check `claim_cache` table.
- If a cached verdict exists and is < 24 hours old, return it immediately.
- Normalization before hashing: lowercase, trim whitespace, strip punctuation.

### Step 2 — Google Fact Check API

- Query with the claim text.
- If matching fact-checks exist from established organizations (Snopes, PolitiFact, AFP Fact Check, etc.), use those as primary evidence.
- Include the original fact-checker's name and rating in the response.
- If no results, proceed to Step 3.

### Step 3 — LLM Analysis with Web Grounding (OpenRouter)

- Model: Gemini with Google Search grounding (single API call handles search + analysis).
- System prompt instructs the model to:
  - Search for evidence about the claim
  - Evaluate source credibility
  - Assign a verdict: **True / Mostly True / Mixed / Mostly False / False / Satire / Unverifiable**
  - Assign confidence: **High / Medium / Low** with reasoning
  - List sources with URLs
  - Provide explanation in both the claim's original language AND Persian
  - If the claim is already in Persian, provide explanation in Persian with key terms in English

## Response Format

```
[Verdict Emoji] Verdict: False (High Confidence)

📋 Claim: "Iran's population declined by 10M in 2025"

🔍 Analysis:
[English or original language explanation with sources]

🔍 تحلیل:
[Persian translation of the analysis]

📎 Sources:
- source1.com
- source2.com

⚡ Via Google Fact Check / AI Analysis
```

## Storage Schema (D1)

### `users`

```sql
CREATE TABLE users (
  client_id TEXT PRIMARY KEY,
  username TEXT,
  language TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
```

### `daily_usage`

```sql
CREATE TABLE daily_usage (
  user_id TEXT NOT NULL,
  timestamp TEXT NOT NULL
);
CREATE INDEX idx_usage_user_ts ON daily_usage (user_id, timestamp);
```

- Rate limit: 5 requests per 60-second sliding window.
- Reject with "Please wait a moment" when exceeded.
- Cron Trigger deletes rows older than 24h.

### `claim_cache`

```sql
CREATE TABLE claim_cache (
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
```

- TTL: 24 hours. Cron Trigger purges expired entries daily.

## Project Structure

```
fact-checker-bot/
  src/
    index.ts           -- Worker entrypoint, Telegram webhook handler
    router.ts          -- Route dispatch (webhook, health, set-webhook)
    input-parser.ts    -- Detect & normalize input (text/image/URL)
    fact-checker.ts    -- Pipeline orchestrator (cache → API → LLM)
    fact-check-api.ts  -- Google Fact Check API client
    openrouter.ts      -- OpenRouter client (vision + web grounding)
    url-extractor.ts   -- Fetch & extract content from URLs/tweets
    formatter.ts       -- Build bilingual response message
    rate-limiter.ts    -- D1-backed per-user rate limiting
    cache.ts           -- Claim cache read/write
    config.ts          -- Environment bindings & constants
    types.ts           -- Shared types (Verdict, Confidence, Claim, etc.)
  schema.sql           -- D1 table definitions
  wrangler.toml        -- Worker config, D1 binding, cron triggers
  package.json
  tsconfig.json
  vitest.config.ts
  test/
    input-parser.test.ts
    fact-checker.test.ts
    formatter.test.ts
    rate-limiter.test.ts
  Makefile             -- dev, deploy, db-migrate, secret targets
  CLAUDE.md            -- Claude Code guidance
  .github/
    workflows/
      deploy.yml       -- Deploy on push to main
```

## API Routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhook` | Telegram sends updates here |
| `GET` | `/health` | Health check |
| `POST` | `/set-webhook` | One-time setup to register webhook URL with Telegram |

## Secrets

Managed via `wrangler secret put`:

- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_API_KEY`
- `GOOGLE_FACT_CHECK_API_KEY`

## Deployment

- **CLI:** `wrangler deploy`
- **CI:** GitHub Actions on push to `main` — install deps → run tests → deploy
- **DB migrations:** `wrangler d1 execute fact-checker-db --remote --file=schema.sql`
- **Secrets:** Stored in GitHub repo settings for CI, or `wrangler secret put` for manual setup

## Rate Limiting

- Per-user: 5 requests per 60-second sliding window (D1-backed).
- Rejected requests get a friendly "Please wait a moment" reply.
- Daily cleanup via Cron Trigger.

## Future Phase: Group Mode

- Bot added to Telegram groups.
- Responds when mentioned (`@botname`) or when replying to a message with `/check`.
- Same pipeline, but triggered by group interactions instead of direct messages.
- Rate limiting applies per-group to prevent spam.

## Testing Strategy

- Unit tests for each module using Vitest + `@cloudflare/vitest-pool-workers`.
- Mock OpenRouter responses with `msw` or manual fetch mocks.
- Mock Telegram webhook payloads for integration tests.
- D1 tested via Miniflare (local D1 emulation in Vitest).

## Confidence & Verdict Scale

**Verdicts:** True, Mostly True, Mixed, Mostly False, False, Satire, Unverifiable

**Confidence:** High, Medium, Low — shown alongside verdict with reasoning. "Unverifiable" is used when confidence is too low for any concrete verdict.
