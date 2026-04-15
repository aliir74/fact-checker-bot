import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { factCheck } from "../src/fact-checker";
import { setCachedClaim } from "../src/cache";
import { Env } from "../src/config";
import { ClaimInput } from "../src/types";

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

function makeEnv(): Env {
  return {
    DB: env.DB,
    TELEGRAM_BOT_TOKEN: "test-bot-token",
    OPENROUTER_API_KEY: "test-openrouter-key",
    GOOGLE_FACT_CHECK_API_KEY: "test-google-key",
    TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
    SENTRY_DSN: "",
  };
}

function mockFetchResponses() {
  const originalFetch = globalThis.fetch;
  const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    // Google Fact Check API — return no results
    if (url.includes("factchecktools.googleapis.com")) {
      return new Response(JSON.stringify({ claims: [] }), { status: 200 });
    }

    // OpenRouter — return a fact-check result
    if (url.includes("openrouter.ai")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdict: "False",
                  confidence: "High",
                  analysis_original: "This claim is false.",
                  analysis_fa: "\u0627\u06CC\u0646 \u0627\u062F\u0639\u0627 \u0646\u0627\u062F\u0631\u0633\u062A \u0627\u0633\u062A.",
                  sources: ["https://example.com"],
                }),
              },
            },
          ],
        }),
        { status: 200 }
      );
    }

    // Telegram getFile API
    if (url.includes("api.telegram.org") && url.includes("getFile")) {
      return new Response(
        JSON.stringify({ result: { file_path: "photos/test.jpg" } }),
        { status: 200 }
      );
    }

    // Telegram file download (OpenRouter vision will receive this URL)
    if (url.includes("api.telegram.org/file")) {
      return new Response("image-data", { status: 200 });
    }

    // fxtwitter
    if (url.includes("api.fxtwitter.com")) {
      return new Response(
        JSON.stringify({
          tweet: { text: "Tweet content here", author: { name: "Author" } },
        }),
        { status: 200 }
      );
    }

    // Generic URL fetch
    return originalFetch(input, init);
  });

  globalThis.fetch = mockFetch as typeof fetch;
  return { mockFetch, originalFetch };
}

describe("factCheck", () => {
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    await setupDB();
    const mocks = mockFetchResponses();
    originalFetch = mocks.originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("processes a text claim through the full pipeline", async () => {
    const testEnv = makeEnv();
    const claim: ClaimInput = { type: "text", text: "The earth is flat" };

    const { result, fromCache } = await factCheck(testEnv, claim);

    expect(fromCache).toBe(false);
    expect(result.verdict).toBe("False");
    expect(result.confidence).toBe("High");
    expect(result.analysisEn).toBeTruthy();
    expect(result.analysisFa).toBeTruthy();
    expect(result.sources).toContain("https://example.com");
  });

  it("returns cached result on second call with same claim", async () => {
    const testEnv = makeEnv();
    const claim: ClaimInput = { type: "text", text: "The earth is flat" };

    // First call — cache miss
    const first = await factCheck(testEnv, claim);
    expect(first.fromCache).toBe(false);

    // Second call — cache hit
    const second = await factCheck(testEnv, claim);
    expect(second.fromCache).toBe(true);
    expect(second.result.verdict).toBe("False");
  });

  it("handles image input by calling getFile and vision OCR", async () => {
    const testEnv = makeEnv();
    const claim: ClaimInput = {
      type: "image",
      fileId: "test-file-id",
      caption: "Check this",
    };

    const { result, fromCache } = await factCheck(testEnv, claim);

    expect(fromCache).toBe(false);
    expect(result.verdict).toBeTruthy();
  });

  it("handles URL input by extracting content", async () => {
    const testEnv = makeEnv();
    const claim: ClaimInput = {
      type: "url",
      url: "https://x.com/user/status/12345",
    };

    const { result, fromCache } = await factCheck(testEnv, claim);

    expect(fromCache).toBe(false);
    expect(result.verdict).toBeTruthy();
  });

  it("returns Unverifiable when claim text cannot be resolved", async () => {
    const testEnv = makeEnv();
    const claim: ClaimInput = { type: "rejected", reason: "unsupported" };

    const { result } = await factCheck(testEnv, claim);

    expect(result.verdict).toBe("Unverifiable");
    expect(result.confidence).toBe("Low");
  });

  it("returns Unverifiable for command input type", async () => {
    const testEnv = makeEnv();
    const claim: ClaimInput = { type: "command", command: "/start" };

    const { result } = await factCheck(testEnv, claim);

    expect(result.verdict).toBe("Unverifiable");
    expect(result.confidence).toBe("Low");
  });

  it("sets sourceType to fact_check_api when fact-check results exist", async () => {
    const testEnv = makeEnv();

    // Override fetch to return fact-check results from Google API
    const originalFetch2 = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("factchecktools.googleapis.com")) {
        return new Response(
          JSON.stringify({
            claims: [
              {
                text: "Earth is flat",
                claimReview: [
                  {
                    publisher: { name: "Snopes" },
                    url: "https://snopes.com/flat-earth",
                    textualRating: "False",
                  },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }

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
                    sources: ["https://snopes.com/flat-earth"],
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return originalFetch2(input, init);
    }) as typeof fetch;

    const claim: ClaimInput = { type: "text", text: "The earth is flat" };
    const { result } = await factCheck(testEnv, claim);

    expect(result.sourceType).toBe("fact_check_api");

    globalThis.fetch = originalFetch2;
  });

  it("falls back to caption when image OCR returns empty", async () => {
    const testEnv = makeEnv();

    // Override fetch: vision OCR returns empty, analysis works
    const originalFetch2 = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("api.telegram.org") && url.includes("getFile")) {
        return new Response(
          JSON.stringify({ result: { file_path: "photos/test.jpg" } }),
          { status: 200 }
        );
      }

      if (url.includes("openrouter.ai")) {
        // Check if this is a vision request (for OCR)
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (body.model?.includes("flash-001")) {
          // Vision model — return empty content (OCR failed)
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "" } }] }),
            { status: 200 }
          );
        }
        // Analysis model
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    verdict: "False",
                    confidence: "Medium",
                    analysis_original: "Based on caption.",
                    analysis_fa: "\u0628\u0631 \u0627\u0633\u0627\u0633 \u06A9\u067E\u0634\u0646.",
                    sources: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.includes("factchecktools.googleapis.com")) {
        return new Response(JSON.stringify({ claims: [] }), { status: 200 });
      }

      return originalFetch2(input, init);
    }) as typeof fetch;

    const claim: ClaimInput = {
      type: "image",
      fileId: "test-file",
      caption: "Is this true?",
    };
    const { result } = await factCheck(testEnv, claim);

    expect(result.verdict).toBeTruthy();

    globalThis.fetch = originalFetch2;
  });

  it("falls back to surroundingText when URL extraction fails", async () => {
    const testEnv = makeEnv();

    const originalFetch2 = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      // Make URL extraction fail
      if (url.includes("api.fxtwitter.com") || url.includes("example.com/article")) {
        return new Response("Not Found", { status: 404 });
      }

      if (url.includes("openrouter.ai")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    verdict: "Mixed",
                    confidence: "Low",
                    analysis_original: "From surrounding text.",
                    analysis_fa: "\u0627\u0632 \u0645\u062A\u0646 \u0627\u0637\u0631\u0627\u0641.",
                    sources: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.includes("factchecktools.googleapis.com")) {
        return new Response(JSON.stringify({ claims: [] }), { status: 200 });
      }

      return originalFetch2(input, init);
    }) as typeof fetch;

    const claim: ClaimInput = {
      type: "url",
      url: "https://example.com/article",
      surroundingText: "Check this article about climate",
    };
    const { result } = await factCheck(testEnv, claim);

    expect(result.verdict).toBeTruthy();

    globalThis.fetch = originalFetch2;
  });

  it("handles URL with successful extraction and author and surroundingText", async () => {
    const testEnv = makeEnv();

    const originalFetch2 = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("api.fxtwitter.com")) {
        return new Response(
          JSON.stringify({
            tweet: { text: "Some tweet content", author: { name: "AuthorName" } },
          }),
          { status: 200 }
        );
      }

      if (url.includes("openrouter.ai")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    verdict: "True",
                    confidence: "High",
                    analysis_original: "Verified.",
                    analysis_fa: "\u062A\u0627\u06CC\u06CC\u062F \u0634\u062F.",
                    sources: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.includes("factchecktools.googleapis.com")) {
        return new Response(JSON.stringify({ claims: [] }), { status: 200 });
      }

      return originalFetch2(input, init);
    }) as typeof fetch;

    const claim: ClaimInput = {
      type: "url",
      url: "https://x.com/user/status/999",
      surroundingText: "Is this accurate?",
    };
    const { result } = await factCheck(testEnv, claim);

    expect(result.verdict).toBe("True");

    globalThis.fetch = originalFetch2;
  });

  it("handles cached claim with invalid sources JSON", async () => {
    const testEnv = makeEnv();

    // Pre-populate cache with the actual hash of "cached claim test"
    const { hashClaim } = await import("../src/cache");
    const hash = await hashClaim("cached claim test");

    await setCachedClaim(env.DB, {
      claim_hash: hash,
      claim_text: "cached claim test",
      verdict: "True",
      confidence: "High",
      analysis_en: "It is true.",
      analysis_fa: "\u062F\u0631\u0633\u062A \u0627\u0633\u062A.",
      sources: "not-valid-json",
      source_type: "fact_check_api",
      created_at: new Date().toISOString(),
    });

    const claim: ClaimInput = { type: "text", text: "cached claim test" };
    const { result, fromCache } = await factCheck(testEnv, claim);

    expect(fromCache).toBe(true);
    expect(result.sources).toEqual([]);
    expect(result.verdict).toBe("True");
  });

  it("handles cached claim with null sources", async () => {
    const testEnv = makeEnv();

    const { hashClaim } = await import("../src/cache");
    const hash = await hashClaim("cached null sources");

    await env.DB.prepare(
      "INSERT INTO claim_cache (claim_hash, claim_text, verdict, confidence, analysis_en, analysis_fa, sources, source_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    )
      .bind(hash, "cached null sources", "False", "High", "en", "fa", null, "ai_analysis")
      .run();

    const claim: ClaimInput = { type: "text", text: "cached null sources" };
    const { result, fromCache } = await factCheck(testEnv, claim);

    expect(fromCache).toBe(true);
    expect(result.sources).toEqual([]);
  });

  it("handles image without caption when OCR returns empty", async () => {
    const testEnv = makeEnv();

    const originalFetch2 = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("api.telegram.org") && url.includes("getFile")) {
        return new Response(
          JSON.stringify({ result: { file_path: "photos/test.jpg" } }),
          { status: 200 }
        );
      }

      if (url.includes("openrouter.ai")) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (body.model?.includes("flash-001")) {
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "" } }] }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              verdict: "Unverifiable", confidence: "Low",
              analysis_original: "err", analysis_fa: "err", sources: [],
            }) } }],
          }),
          { status: 200 }
        );
      }

      if (url.includes("factchecktools.googleapis.com")) {
        return new Response(JSON.stringify({ claims: [] }), { status: 200 });
      }

      return originalFetch2(input, init);
    }) as typeof fetch;

    const claim: ClaimInput = { type: "image", fileId: "test-file" };
    const { result } = await factCheck(testEnv, claim);

    // No caption, no OCR text — should return Unverifiable
    expect(result.verdict).toBe("Unverifiable");
    expect(result.claimText).toBe("");

    globalThis.fetch = originalFetch2;
  });

  it("handles image without caption when OCR succeeds", async () => {
    const testEnv = makeEnv();

    // Original image test has caption — this one has no caption, OCR works
    const { result } = await factCheck(testEnv, {
      type: "image",
      fileId: "test-file-no-caption",
    });

    // OCR returns text from mock, no caption
    expect(result.verdict).toBeTruthy();
  });

  it("handles URL with content but no author (generic URL)", async () => {
    const testEnv = makeEnv();

    const originalFetch2 = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      // Generic URL returns HTML (no author field in result)
      if (url.includes("example.com/article")) {
        return new Response(
          "<html><title>Test Article</title><body>Article content about something important</body></html>",
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (url.includes("openrouter.ai")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    verdict: "True",
                    confidence: "Medium",
                    analysis_original: "Verified from article.",
                    analysis_fa: "\u062A\u0627\u06CC\u06CC\u062F \u0634\u062F.",
                    sources: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.includes("factchecktools.googleapis.com")) {
        return new Response(JSON.stringify({ claims: [] }), { status: 200 });
      }

      return originalFetch2(input, init);
    }) as typeof fetch;

    const claim: ClaimInput = {
      type: "url",
      url: "https://example.com/article",
    };
    const { result } = await factCheck(testEnv, claim);

    expect(result.verdict).toBe("True");

    globalThis.fetch = originalFetch2;
  });

  it("handles URL without surroundingText when extraction fails", async () => {
    const testEnv = makeEnv();

    const originalFetch2 = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("api.fxtwitter.com") || url.includes("example.com")) {
        return new Response("Not Found", { status: 404 });
      }

      if (url.includes("factchecktools.googleapis.com")) {
        return new Response(JSON.stringify({ claims: [] }), { status: 200 });
      }

      return originalFetch2(input);
    }) as typeof fetch;

    const claim: ClaimInput = { type: "url", url: "https://example.com/bad" };
    const { result } = await factCheck(testEnv, claim);

    // No surroundingText, extraction failed → null → Unverifiable
    expect(result.verdict).toBe("Unverifiable");
    expect(result.claimText).toBe("");

    globalThis.fetch = originalFetch2;
  });
});
