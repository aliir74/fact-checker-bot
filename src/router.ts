import { Env } from "./config";
import { upsertUser } from "./cache";
import { checkRateLimit, recordRequest } from "./rate-limiter";
import { parseInput } from "./input-parser";
import { factCheck } from "./fact-checker";
import {
  formatResponse,
  formatRateLimitResponse,
  formatErrorResponse,
  formatRejectedInputResponse,
  formatTruncatedNotice,
  formatWelcomeMessage,
} from "./formatter";
import { sendMessage, sendChatAction, setWebhook } from "./telegram";
import { TelegramUpdate } from "./types";

export async function handleRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/health" && request.method === "GET") {
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (path === "/webhook" && request.method === "POST") {
    return handleWebhook(request, env);
  }

  if (path === "/set-webhook" && request.method === "POST") {
    return handleSetWebhook(request, env);
  }

  return new Response("Not Found", { status: 404 });
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  // Verify webhook secret
  const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const update = (await request.json()) as TelegramUpdate;
    const message = update.message;

    if (!message) {
      return new Response("OK", { status: 200 });
    }

    const chatId = message.chat.id;
    const userId = String(message.from?.id ?? chatId);
    const username = message.from?.username;

    // Upsert user
    await upsertUser(env.DB, userId, username);

    // Parse input
    const input = parseInput(message);

    if (input.type === "command") {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        formatWelcomeMessage()
      );
      return new Response("OK", { status: 200 });
    }

    if (input.type === "rejected") {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        formatRejectedInputResponse()
      );
      return new Response("OK", { status: 200 });
    }

    // Check rate limit
    const rateLimit = await checkRateLimit(env.DB, userId);
    if (!rateLimit.allowed) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        formatRateLimitResponse(rateLimit.retryAfterSeconds ?? 60)
      );
      return new Response("OK", { status: 200 });
    }

    // Record request before the potentially slow pipeline
    await recordRequest(env.DB, userId);

    // Show typing indicator
    await sendChatAction(env.TELEGRAM_BOT_TOKEN, chatId, "typing");

    // Run fact-check pipeline
    const { result } = await factCheck(env, input);

    // Format and send response
    let responseText = formatResponse(result, result.claimText);
    if (input.type === "text" && input.truncated) {
      responseText += formatTruncatedNotice();
    }

    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, responseText);
  } catch (error) {
    console.error("Webhook error:", error);
    // Try to send error message if we have enough context
    try {
      const body = await request.clone().json() as TelegramUpdate;
      if (body.message?.chat?.id) {
        await sendMessage(
          env.TELEGRAM_BOT_TOKEN,
          body.message.chat.id,
          formatErrorResponse()
        );
      }
    } catch {
      // Ignore — we can't send an error message
    }
  }

  // Always return 200 to prevent Telegram retries
  return new Response("OK", { status: 200 });
}

async function handleSetWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const workerUrl = new URL(request.url);
    const webhookUrl = `${workerUrl.origin}/webhook`;

    const result = await setWebhook(
      env.TELEGRAM_BOT_TOKEN,
      webhookUrl,
      env.TELEGRAM_WEBHOOK_SECRET
    );

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Set webhook error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to set webhook" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
