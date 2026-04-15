import { purgeExpiredCache } from "./cache";
import { Env } from "./config";
import { purgeOldUsage } from "./rate-limiter";
import { handleRequest } from "./router";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error("Unhandled error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(purgeExpiredCache(env.DB));
    ctx.waitUntil(purgeOldUsage(env.DB));
  },
};
