# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack
- **Runtime:** Cloudflare Workers (TypeScript)
- **Storage:** Cloudflare D1 (SQLite)
- **LLM:** OpenRouter (Gemini Flash for vision, Gemini 2.5 Flash for analysis with web grounding)
- **Fact-check lookup:** Google Fact Check Tools API
- **Telegram:** Webhook mode
- **Tests:** Vitest + @cloudflare/vitest-pool-workers (Miniflare)
- **Package manager:** pnpm

## Commands
- `pnpm dev` — local dev server (wrangler)
- `pnpm test` — run all tests
- `pnpm test:watch` — watch mode
- `pnpm test -- test/cache.test.ts` — run a single test file
- `pnpm deploy` — deploy to Cloudflare Workers
- `pnpm db:migrate:local` — apply `schema.sql` to local D1
- `pnpm db:migrate:remote` — apply `schema.sql` to production D1

## Architecture

```
Telegram webhook POST /webhook
  → router.ts (auth, routing)
    → input-parser.ts (classify: text | image | url | command | rejected)
    → cache.ts (SHA-256 hash lookup in D1)
    → rate-limiter.ts (5 req/60s sliding window per user)
    → fact-checker.ts (orchestrator):
        1. resolveClaimText: text passthrough / image OCR via vision model / URL fetch
        2. queryFactCheck: Google Fact Check Tools API lookup
        3. analyzeClaimWithGrounding: OpenRouter LLM with web search plugin
        4. Cache result in D1
    → formatter.ts (bilingual EN+FA response with verdict emoji)
    → telegram.ts (send reply)
```

**Entry point:** `src/index.ts` exports `fetch` (webhook handler) and `scheduled` (daily cache/usage purge via cron at 03:00 UTC).

**Input types flow:** `parseInput()` returns a discriminated union (`ClaimInput`) with types: `text`, `image`, `url`, `command`, `rejected`. The `fact-checker.ts` orchestrator resolves each type to plain text before LLM analysis.

## Key Patterns
- All D1 queries use `env.DB.prepare().bind().run()` / `.first()` / `.all()`
- OpenRouter calls via standard `fetch` to `https://openrouter.ai/api/v1/chat/completions`
- Always return 200 to Telegram webhooks (non-200 triggers retries)
- Webhook auth via `X-Telegram-Bot-Api-Secret-Token` header
- Use `crypto.subtle.digest` for SHA-256 (Workers runtime built-in)
- Cache normalization strips punctuation and lowercases before hashing (`cache.ts:normalizeForHash`)
- Twitter/X URLs are fetched via `api.fxtwitter.com` (no auth needed), generic URLs are fetched and HTML-stripped
- LLM responses use `response_format: { type: "json_object" }` with `plugins: [{ id: "web" }]` for web grounding
- Two OpenRouter models: `google/gemini-2.0-flash-001` (vision/OCR) and `google/gemini-2.5-flash` (analysis)
- All responses are bilingual (English + Persian/Farsi)

## D1 Schema (schema.sql)
Three tables: `users` (tracking), `daily_usage` (rate limiting), `claim_cache` (24h TTL result cache). Schema changes go in `schema.sql` and are applied via `pnpm db:migrate:*`.

## Testing
Tests run in Miniflare (Cloudflare's local simulator) via `@cloudflare/vitest-pool-workers`. Test bindings are configured in `vitest.config.ts` with dummy secret values. Tests that hit external APIs (Telegram, OpenRouter, Google) mock `globalThis.fetch` — see `test/webhook.test.ts` for the pattern. Each integration test must call `setupDB()` in `beforeEach` to create tables in the ephemeral D1 instance.

## Secrets (via `wrangler secret put`)
- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_API_KEY`
- `GOOGLE_FACT_CHECK_API_KEY`
- `TELEGRAM_WEBHOOK_SECRET`
