# Sentry Integration for Fact-Checker Bot

## Overview

Add `@sentry/cloudflare` to the fact-checker Telegram bot for automatic exception capture and breadcrumb-level observability across key pipeline steps.

**Instrumentation level:** Standard — unhandled exceptions + breadcrumbs at Telegram, OpenRouter, Google Fact Check API, and D1 cache boundaries.

## Approach

Use the official `@sentry/cloudflare` SDK (`withSentry()` wrapper). The SDK handles stack trace parsing, error deduplication, transport, and context propagation automatically.

## Changes

### 1. Dependencies & Config

- **Install:** `pnpm add @sentry/cloudflare`
- **`src/config.ts`:** Add `SENTRY_DSN: string` to the `Env` interface
- **Secret:** `wrangler secret put SENTRY_DSN` with the DSN from Sentry project settings
- **No `wrangler.toml` changes** — the SDK uses `fetch()` for transport

### 2. Entry Point (`src/index.ts`)

Replace the manual try/catch with `withSentry()` wrapping both `fetch` and `scheduled` handlers:

```typescript
import * as Sentry from "@sentry/cloudflare";

export default withSentry(
  (env) => ({ dsn: env.SENTRY_DSN }),
  {
    async fetch(request, env, ctx) {
      return await handleRequest(request, env);
    },
    async scheduled(event, env, ctx) {
      ctx.waitUntil(purgeExpiredCache(env.DB));
      ctx.waitUntil(purgeOldUsage(env.DB));
    },
  } satisfies ExportedHandler<Env>
);
```

The existing try/catch in `router.ts` (`handleWebhook`) stays — it sends the user-facing error message via Telegram and returns 200. Sentry captures the error at the outer `withSentry` boundary before the inner catch swallows it. **Correction:** Since `handleWebhook` catches errors internally and does not re-throw, `withSentry` at the `index.ts` level won't see webhook processing errors. To capture these in Sentry, the catch block in `router.ts` must explicitly call `Sentry.captureException(error)` before handling the error response.

### 3. Breadcrumbs (4 locations)

| File | Where | Breadcrumb message | Category |
|------|-------|--------------------|----------|
| `src/telegram.ts` | Before each `fetch()` call in `sendMessage`, `sendChatAction`, `setWebhook` | `"Telegram API: {method}"` | `telegram` |
| `src/openrouter.ts` | Before the `fetch()` call to OpenRouter | `"OpenRouter LLM call"` | `ai` |
| `src/fact-check-api.ts` | Before the `fetch()` call to Google Fact Check API | `"Google Fact Check API query"` | `api` |
| `src/cache.ts` | After cache lookup resolves (hit or miss) | `"Cache {hit\|miss} for claim"` | `cache` |

Example breadcrumb call:

```typescript
Sentry.addBreadcrumb({
  category: "telegram",
  message: "Telegram API: sendMessage",
  level: "info",
});
```

### 4. Error Context Enrichment (`src/router.ts`)

In `handleWebhook`, after parsing the update and before the pipeline runs, set Sentry context:

```typescript
Sentry.setUser({ id: userId, username });
Sentry.setTag("chat_id", String(chatId));
Sentry.setTag("input_type", input.type);
```

In the catch block, explicitly capture the exception:

```typescript
catch (error) {
  Sentry.captureException(error);
  console.error("Webhook error:", error);
  // ...existing error response logic...
}
```

### 5. Unchanged

- **Test files** — Sentry no-ops without a DSN, no test changes needed
- **`wrangler.toml`** — no bindings required
- **Scheduled handler logic** — only wrapped, internal logic untouched
- **User-facing error flow** — Telegram still gets the error message via `formatErrorResponse()`

## Files Modified

| File | Change |
|------|--------|
| `package.json` | Add `@sentry/cloudflare` dependency |
| `src/config.ts` | Add `SENTRY_DSN` to `Env` |
| `src/index.ts` | Replace try/catch with `withSentry()` wrapper |
| `src/router.ts` | Add `Sentry.setUser()`, `setTag()`, `captureException()` |
| `src/telegram.ts` | Add breadcrumbs before API calls |
| `src/openrouter.ts` | Add breadcrumb before LLM call |
| `src/fact-check-api.ts` | Add breadcrumb before API call |
| `src/cache.ts` | Add breadcrumb on cache hit/miss |

## Files Not Modified

| File | Reason |
|------|--------|
| `src/formatter.ts` | No external calls, no error handling |
| `src/input-parser.ts` | Pure parsing logic, no async/external |
| `src/types.ts` | Type definitions only |
| `src/rate-limiter.ts` | Internal D1 queries, errors bubble up to router |
| `src/url-extractor.ts` | Pure parsing logic |
| `wrangler.toml` | SDK uses fetch transport, no bindings needed |
| `test/**` | Sentry no-ops without DSN |
