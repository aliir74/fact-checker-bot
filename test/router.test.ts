import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

describe("Router", () => {
  it("GET /health returns 200 with status ok", async () => {
    const response = await SELF.fetch("http://localhost/health");
    expect(response.status).toBe(200);
    const body = await response.json<{ status: string }>();
    expect(body.status).toBe("ok");
  });

  it("POST /webhook without secret returns 401", async () => {
    const response = await SELF.fetch("http://localhost/webhook", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(401);
  });

  it("POST /webhook with valid secret returns 200", async () => {
    const response = await SELF.fetch("http://localhost/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret",
      },
      body: JSON.stringify({ update_id: 1 }),
    });
    expect(response.status).toBe(200);
  });

  it("unknown path returns 404", async () => {
    const response = await SELF.fetch("http://localhost/unknown");
    expect(response.status).toBe(404);
  });

  it("GET /webhook returns 404", async () => {
    const response = await SELF.fetch("http://localhost/webhook", {
      method: "GET",
    });
    expect(response.status).toBe(404);
  });
});
