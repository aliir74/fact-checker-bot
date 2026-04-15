import * as Sentry from "@sentry/cloudflare";

export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  parseMode?: string
): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (parseMode) {
    body.parse_mode = parseMode;
  }
  await telegramApi(token, "sendMessage", body);
}

export async function sendChatAction(
  token: string,
  chatId: number,
  action: string
): Promise<void> {
  await telegramApi(token, "sendChatAction", { chat_id: chatId, action });
}

export async function getFileUrl(
  token: string,
  fileId: string
): Promise<string> {
  const result = await telegramApi(token, "getFile", { file_id: fileId });
  const filePath = result?.result?.file_path;
  if (!filePath) {
    throw new Error("Failed to get file path from Telegram");
  }
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

export async function setWebhook(
  token: string,
  url: string,
  secretToken?: string
): Promise<unknown> {
  const body: Record<string, unknown> = { url };
  if (secretToken) {
    body.secret_token = secretToken;
  }
  return telegramApi(token, "setWebhook", body);
}

async function telegramApi(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<{ result?: Record<string, unknown> }> {
  Sentry.addBreadcrumb({
    category: "telegram",
    message: `Telegram API: ${method}`,
    level: "info",
  });

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return response.json() as Promise<{ result?: Record<string, unknown> }>;
}
