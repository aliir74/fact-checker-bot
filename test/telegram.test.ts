import { describe, it, expect, vi, afterEach } from "vitest";
import {
  sendMessage,
  sendChatAction,
  getFileUrl,
  setWebhook,
} from "../src/telegram";

describe("telegram", () => {
  let originalFetch: typeof fetch;

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    vi.restoreAllMocks();
  });

  function mockTelegramApi(responseBody: unknown) {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify(responseBody), { status: 200 });
    }) as typeof fetch;
  }

  describe("sendMessage", () => {
    it("sends message without parseMode", async () => {
      mockTelegramApi({ ok: true });

      await sendMessage("token", 123, "hello");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottoken/sendMessage",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ chat_id: 123, text: "hello" }),
        })
      );
    });

    it("sends message with parseMode", async () => {
      mockTelegramApi({ ok: true });

      await sendMessage("token", 123, "hello", "HTML");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottoken/sendMessage",
        expect.objectContaining({
          body: JSON.stringify({
            chat_id: 123,
            text: "hello",
            parse_mode: "HTML",
          }),
        })
      );
    });
  });

  describe("sendChatAction", () => {
    it("sends chat action", async () => {
      mockTelegramApi({ ok: true });

      await sendChatAction("token", 123, "typing");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottoken/sendChatAction",
        expect.objectContaining({
          body: JSON.stringify({ chat_id: 123, action: "typing" }),
        })
      );
    });
  });

  describe("getFileUrl", () => {
    it("returns file URL on success", async () => {
      mockTelegramApi({ result: { file_path: "photos/test.jpg" } });

      const url = await getFileUrl("token", "file-123");

      expect(url).toBe(
        "https://api.telegram.org/file/bottoken/photos/test.jpg"
      );
    });

    it("throws when file_path is missing", async () => {
      mockTelegramApi({ result: {} });

      await expect(getFileUrl("token", "file-123")).rejects.toThrow(
        "Failed to get file path from Telegram"
      );
    });

    it("throws when result is missing", async () => {
      mockTelegramApi({});

      await expect(getFileUrl("token", "file-123")).rejects.toThrow(
        "Failed to get file path from Telegram"
      );
    });
  });

  describe("setWebhook", () => {
    it("sets webhook without secret token", async () => {
      mockTelegramApi({ ok: true });

      await setWebhook("token", "https://example.com/webhook");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottoken/setWebhook",
        expect.objectContaining({
          body: JSON.stringify({ url: "https://example.com/webhook" }),
        })
      );
    });

    it("sets webhook with secret token", async () => {
      mockTelegramApi({ ok: true });

      await setWebhook("token", "https://example.com/webhook", "secret-123");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottoken/setWebhook",
        expect.objectContaining({
          body: JSON.stringify({
            url: "https://example.com/webhook",
            secret_token: "secret-123",
          }),
        })
      );
    });
  });
});
