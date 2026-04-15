import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SELF, env } from "cloudflare:test";

async function setupDB() {
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS users (client_id TEXT PRIMARY KEY, username TEXT, language TEXT, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)"
  );
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS daily_usage (user_id TEXT NOT NULL, timestamp TEXT NOT NULL)"
  );
  await env.DB.exec(
    "CREATE INDEX IF NOT EXISTS idx_usage_user_ts ON daily_usage (user_id, timestamp)"
  );
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS claim_cache (claim_hash TEXT PRIMARY KEY, claim_text TEXT NOT NULL, verdict TEXT NOT NULL, confidence TEXT NOT NULL, analysis_en TEXT, analysis_fa TEXT, sources TEXT, source_type TEXT NOT NULL, created_at TEXT NOT NULL)"
  );
}

function makeTextUpdate(text: string) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 123, first_name: "Test", username: "testuser" },
      chat: { id: 123, type: "private" },
      text,
    },
  };
}

function makeVoiceUpdate() {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 123, first_name: "Test" },
      chat: { id: 123, type: "private" },
      voice: { duration: 5 },
    },
  };
}

function mockExternalApis() {
  const sentMessages: Array<{ chat_id: number; text: string; parse_mode?: string }> = [];
  const originalFetch = globalThis.fetch;

  const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    // Capture Telegram sendMessage calls
    if (url.includes("api.telegram.org") && url.includes("sendMessage")) {
      const body = JSON.parse((init?.body as string) || "{}");
      sentMessages.push({ chat_id: body.chat_id, text: body.text, parse_mode: body.parse_mode });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Telegram sendChatAction — just acknowledge
    if (url.includes("api.telegram.org") && url.includes("sendChatAction")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Google Fact Check API
    if (url.includes("factchecktools.googleapis.com")) {
      return new Response(JSON.stringify({ claims: [] }), { status: 200 });
    }

    // OpenRouter
    if (url.includes("openrouter.ai")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdict: "False",
                  confidence: "High",
                  analysis_original: "This is false.",
                  analysis_fa: "\u0646\u0627\u062F\u0631\u0633\u062A \u0627\u0633\u062A.",
                  sources: ["https://example.com"],
                }),
              },
            },
          ],
        }),
        { status: 200 }
      );
    }

    return originalFetch(input, init);
  });

  globalThis.fetch = mockFetch as typeof fetch;
  return { mockFetch, originalFetch, sentMessages };
}

describe("Webhook handler", () => {
  let originalFetch: typeof fetch;
  let sentMessages: Array<{ chat_id: number; text: string; parse_mode?: string }>;

  beforeEach(async () => {
    await setupDB();
    const mocks = mockExternalApis();
    originalFetch = mocks.originalFetch;
    sentMessages = mocks.sentMessages;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects requests without valid webhook secret", async () => {
    const response = await SELF.fetch("http://localhost/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "wrong-secret",
      },
      body: JSON.stringify(makeTextUpdate("test")),
    });

    expect(response.status).toBe(401);
  });

  it("accepts requests with valid webhook secret", async () => {
    const response = await SELF.fetch("http://localhost/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret",
      },
      body: JSON.stringify(makeTextUpdate("The earth is flat")),
    });

    expect(response.status).toBe(200);
  });

  it("processes a text claim and sends a response", async () => {
    await SELF.fetch("http://localhost/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret",
      },
      body: JSON.stringify(makeTextUpdate("The earth is flat")),
    });

    expect(sentMessages.length).toBeGreaterThan(0);
    const lastMessage = sentMessages[sentMessages.length - 1];
    expect(lastMessage.chat_id).toBe(123);
    expect(lastMessage.text).toContain("Verdict");
    expect(lastMessage.text).toContain("False");
    expect(lastMessage.parse_mode).toBe("HTML");
  });

  it("rejects voice messages with guidance", async () => {
    await SELF.fetch("http://localhost/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret",
      },
      body: JSON.stringify(makeVoiceUpdate()),
    });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].text).toContain("text, a screenshot, or a link");
  });

  it("returns 200 for updates without a message", async () => {
    const response = await SELF.fetch("http://localhost/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret",
      },
      body: JSON.stringify({ update_id: 1 }),
    });

    expect(response.status).toBe(200);
    expect(sentMessages.length).toBe(0);
  });

  it("rate limits after 5 rapid requests", async () => {
    for (let i = 0; i < 6; i++) {
      await SELF.fetch("http://localhost/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret",
        },
        body: JSON.stringify(makeTextUpdate(`Claim number ${i + 1}`)),
      });
    }

    // The 6th request should trigger a rate limit response
    const lastMessage = sentMessages[sentMessages.length - 1];
    expect(lastMessage.text).toContain("wait");
  });

  it("upserts user on webhook request", async () => {
    await SELF.fetch("http://localhost/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret",
      },
      body: JSON.stringify(makeTextUpdate("test claim")),
    });

    const user = await env.DB.prepare(
      "SELECT * FROM users WHERE client_id = ?"
    )
      .bind("123")
      .first();

    expect(user).toBeTruthy();
    expect(user?.username).toBe("testuser");
  });
});
