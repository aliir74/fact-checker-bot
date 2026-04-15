import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  extractTextFromImage,
  analyzeClaimWithGrounding,
} from "../src/openrouter";

const TEST_API_KEY = "test-openrouter-key";

function mockFetchResponse(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const mockFn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", mockFn);
  return mockFn;
}

describe("extractTextFromImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns extracted text from a successful response", async () => {
    mockFetchResponse({
      choices: [
        {
          message: {
            content: "This is the extracted text from the image.",
          },
        },
      ],
    });

    const result = await extractTextFromImage(
      TEST_API_KEY,
      "https://example.com/image.png"
    );

    expect(result).toBe("This is the extracted text from the image.");
  });

  it("returns empty string on API error", async () => {
    mockFetchResponse({ error: "Bad Request" }, 400);

    const result = await extractTextFromImage(
      TEST_API_KEY,
      "https://example.com/image.png"
    );

    expect(result).toBe("");
  });

  it("returns empty string on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error"))
    );

    const result = await extractTextFromImage(
      TEST_API_KEY,
      "https://example.com/image.png"
    );

    expect(result).toBe("");
  });

  it("returns empty string when response has no choices", async () => {
    mockFetchResponse({ choices: [] });

    const result = await extractTextFromImage(
      TEST_API_KEY,
      "https://example.com/image.png"
    );

    expect(result).toBe("");
  });

  it("sends correct headers and model in request", async () => {
    const mockFn = mockFetchResponse({
      choices: [{ message: { content: "text" } }],
    });

    await extractTextFromImage(
      TEST_API_KEY,
      "https://example.com/image.png"
    );

    expect(mockFn).toHaveBeenCalledOnce();
    const [url, options] = mockFn.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");

    const headers = options.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-openrouter-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["HTTP-Referer"]).toBe(
      "https://fact-checker-bot.workers.dev"
    );
    expect(headers["X-Title"]).toBe("Fact Checker Bot");

    const body = JSON.parse(options.body as string);
    expect(body.model).toBe("google/gemini-2.0-flash-001");
    expect(body.temperature).toBe(0.1);
    expect(body.max_tokens).toBe(1000);
  });

  it("sends image_url and text in the message content", async () => {
    const mockFn = mockFetchResponse({
      choices: [{ message: { content: "text" } }],
    });

    await extractTextFromImage(
      TEST_API_KEY,
      "https://example.com/photo.jpg"
    );

    const body = JSON.parse(mockFn.mock.calls[0][1].body as string);
    const userContent = body.messages[0].content;
    expect(userContent).toHaveLength(2);
    expect(userContent[0].type).toBe("image_url");
    expect(userContent[0].image_url.url).toBe(
      "https://example.com/photo.jpg"
    );
    expect(userContent[1].type).toBe("text");
  });
});

describe("analyzeClaimWithGrounding", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed FactCheckResult from a valid JSON response", async () => {
    mockFetchResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "False",
              confidence: "High",
              analysis_original: "This claim is false based on evidence.",
              analysis_fa: "این ادعا بر اساس شواهد نادرست است.",
              sources: [
                "https://reuters.com/fact-check",
                "https://snopes.com/check",
              ],
            }),
          },
        },
      ],
    });

    const result = await analyzeClaimWithGrounding(
      TEST_API_KEY,
      "The earth is flat"
    );

    expect(result.verdict).toBe("False");
    expect(result.confidence).toBe("High");
    expect(result.analysisEn).toBe("This claim is false based on evidence.");
    expect(result.analysisFa).toBe("این ادعا بر اساس شواهد نادرست است.");
    expect(result.sources).toEqual([
      "https://reuters.com/fact-check",
      "https://snopes.com/check",
    ]);
    expect(result.sourceType).toBe("ai_analysis");
    expect(result.claimText).toBe("The earth is flat");
  });

  it("maps invalid verdict to Unverifiable", async () => {
    mockFetchResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "Totally Wrong",
              confidence: "High",
              analysis_original: "Analysis here",
              analysis_fa: "تحلیل",
              sources: [],
            }),
          },
        },
      ],
    });

    const result = await analyzeClaimWithGrounding(
      TEST_API_KEY,
      "some claim"
    );

    expect(result.verdict).toBe("Unverifiable");
  });

  it("maps invalid confidence to Low", async () => {
    mockFetchResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "True",
              confidence: "Very High",
              analysis_original: "Analysis here",
              analysis_fa: "تحلیل",
              sources: [],
            }),
          },
        },
      ],
    });

    const result = await analyzeClaimWithGrounding(
      TEST_API_KEY,
      "some claim"
    );

    expect(result.confidence).toBe("Low");
  });

  it("includes factCheckResults in user message when provided", async () => {
    const mockFn = mockFetchResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "False",
              confidence: "High",
              analysis_original: "Analysis",
              analysis_fa: "تحلیل",
              sources: [],
            }),
          },
        },
      ],
    });

    const factCheckResults = [
      {
        claim: "Earth is flat",
        claimant: "Test",
        rating: "False",
        source: "PolitiFact",
        url: "https://politifact.com/earth",
      },
    ];

    await analyzeClaimWithGrounding(
      TEST_API_KEY,
      "The earth is flat",
      factCheckResults
    );

    const body = JSON.parse(mockFn.mock.calls[0][1].body as string);
    const userMessage = body.messages[1].content as string;
    expect(userMessage).toContain("Claim to fact-check:");
    expect(userMessage).toContain("The earth is flat");
    expect(userMessage).toContain(
      "Existing fact-checks from established organizations:"
    );
    expect(userMessage).toContain("PolitiFact");
    expect(userMessage).toContain('"False"');
    expect(userMessage).toContain("https://politifact.com/earth");
  });

  it("sets sourceType to fact_check_api when factCheckResults provided", async () => {
    mockFetchResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "True",
              confidence: "High",
              analysis_original: "Analysis",
              analysis_fa: "تحلیل",
              sources: [],
            }),
          },
        },
      ],
    });

    const result = await analyzeClaimWithGrounding(
      TEST_API_KEY,
      "claim",
      [
        {
          claim: "claim",
          claimant: "someone",
          rating: "True",
          source: "Snopes",
          url: "https://snopes.com",
        },
      ]
    );

    expect(result.sourceType).toBe("fact_check_api");
  });

  it("returns default error result on API failure", async () => {
    mockFetchResponse({ error: "Server Error" }, 500);

    const result = await analyzeClaimWithGrounding(
      TEST_API_KEY,
      "test claim"
    );

    expect(result.verdict).toBe("Unverifiable");
    expect(result.confidence).toBe("Low");
    expect(result.analysisEn).toContain("API returned status 500");
    expect(result.claimText).toBe("test claim");
    expect(result.sources).toEqual([]);
  });

  it("returns default error result on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Connection refused"))
    );

    const result = await analyzeClaimWithGrounding(
      TEST_API_KEY,
      "test claim"
    );

    expect(result.verdict).toBe("Unverifiable");
    expect(result.confidence).toBe("Low");
    expect(result.analysisEn).toBe("Failed to analyze claim");
    expect(result.claimText).toBe("test claim");
  });

  it("sends correct headers and model in request", async () => {
    const mockFn = mockFetchResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "True",
              confidence: "High",
              analysis_original: "Analysis",
              analysis_fa: "تحلیل",
              sources: [],
            }),
          },
        },
      ],
    });

    await analyzeClaimWithGrounding(TEST_API_KEY, "test claim");

    const [url, options] = mockFn.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");

    const headers = options.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-openrouter-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["HTTP-Referer"]).toBe(
      "https://fact-checker-bot.workers.dev"
    );
    expect(headers["X-Title"]).toBe("Fact Checker Bot");

    const body = JSON.parse(options.body as string);
    expect(body.model).toBe("google/gemini-2.5-flash");
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(4000);
    expect(body.plugins).toEqual([{ id: "web" }]);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("includes system prompt in messages", async () => {
    const mockFn = mockFetchResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "True",
              confidence: "High",
              analysis_original: "Analysis",
              analysis_fa: "تحلیل",
              sources: [],
            }),
          },
        },
      ],
    });

    await analyzeClaimWithGrounding(TEST_API_KEY, "test claim");

    const body = JSON.parse(mockFn.mock.calls[0][1].body as string);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain(
      "You are a professional fact-checker"
    );
    expect(body.messages[1].role).toBe("user");
  });

  it("handles malformed JSON in response content", async () => {
    mockFetchResponse({
      choices: [
        {
          message: {
            content: "this is not valid json {{{",
          },
        },
      ],
    });

    const result = await analyzeClaimWithGrounding(
      TEST_API_KEY,
      "test claim"
    );

    expect(result.verdict).toBe("Unverifiable");
    expect(result.confidence).toBe("Low");
    expect(result.analysisEn).toBe("Failed to analyze claim");
  });

  it("defaults missing fields in parsed response", async () => {
    mockFetchResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({}),
          },
        },
      ],
    });

    const result = await analyzeClaimWithGrounding(
      TEST_API_KEY,
      "test claim"
    );

    expect(result.verdict).toBe("Unverifiable");
    expect(result.confidence).toBe("Low");
    expect(result.analysisEn).toBe("");
    expect(result.analysisFa).toBe("");
    expect(result.sources).toEqual([]);
  });

  it("returns fact_check_api sourceType in default result when factCheckResults provided and API fails", async () => {
    mockFetchResponse({ error: "Server Error" }, 500);

    const result = await analyzeClaimWithGrounding(
      TEST_API_KEY,
      "test claim",
      [
        {
          claim: "test",
          claimant: "someone",
          rating: "True",
          source: "Snopes",
          url: "https://snopes.com",
        },
      ]
    );

    expect(result.sourceType).toBe("fact_check_api");
    expect(result.verdict).toBe("Unverifiable");
  });

  it("returns ai_analysis sourceType in default result when no factCheckResults and API fails via catch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Connection refused"))
    );

    const result = await analyzeClaimWithGrounding(
      TEST_API_KEY,
      "test claim",
      undefined
    );

    expect(result.sourceType).toBe("ai_analysis");
  });

  it("handles missing content in response", async () => {
    mockFetchResponse({
      choices: [{ message: {} }],
    });

    const result = await analyzeClaimWithGrounding(
      TEST_API_KEY,
      "test claim"
    );

    expect(result.verdict).toBe("Unverifiable");
    expect(result.confidence).toBe("Low");
    expect(result.analysisEn).toBe("No content in API response");
  });
});
