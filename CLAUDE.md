# Fact-Checker Telegram Bot

## Stack
- **Runtime:** Cloudflare Workers (TypeScript)
- **Storage:** Cloudflare D1 (SQLite)
- **LLM:** OpenRouter (Gemini with Google Search web grounding + vision)
- **Fact-check lookup:** Google Fact Check Tools API
- **Telegram:** Webhook mode
- **Tests:** Vitest + @cloudflare/vitest-pool-workers (Miniflare)

## Commands
- `pnpm dev` — local dev server
- `pnpm test` — run tests
- `pnpm test:watch` — watch mode
- `pnpm deploy` — deploy to Cloudflare
- `pnpm db:migrate:local` — apply schema locally
- `pnpm db:migrate:remote` — apply schema to production D1

## Architecture
```
Telegram webhook → Worker → Input Parser → Cache Check → Rate Limit Check
  → Google Fact Check API → OpenRouter LLM (web grounding) → Formatter → Reply
```

## Key Patterns
- All D1 queries use `env.DB.prepare().bind().run()` / `.first()` / `.all()`
- OpenRouter calls via standard fetch to `https://openrouter.ai/api/v1/chat/completions`
- Always return 200 to Telegram webhooks (non-200 triggers retries)
- Webhook auth via `X-Telegram-Bot-Api-Secret-Token` header
- Use `crypto.subtle.digest` for SHA-256 (Workers runtime built-in)

## Secrets (via `wrangler secret put`)
- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_API_KEY`
- `GOOGLE_FACT_CHECK_API_KEY`
- `TELEGRAM_WEBHOOK_SECRET`
