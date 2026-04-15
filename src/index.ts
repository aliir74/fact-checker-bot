import * as Sentry from "@sentry/cloudflare";
import { purgeExpiredCache } from "./cache";
import { Env } from "./config";
import { purgeOldUsage } from "./rate-limiter";
import { handleRequest } from "./router";

const handler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    return await handleRequest(request, env);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(purgeExpiredCache(env.DB));
    ctx.waitUntil(purgeOldUsage(env.DB));
  },
};

export default Sentry.withSentry(
  (env: Env) => ({ dsn: env.SENTRY_DSN }),
  handler
);
