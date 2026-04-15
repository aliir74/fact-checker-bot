import { describe, it, expect, beforeEach, vi } from "vitest";
import { queryFactCheck } from "../src/fact-check-api";

const TEST_API_KEY = "test-google-key";

function mockFetchResponse(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    })
  );
}

describe("queryFactCheck", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed results for a successful response with claims", async () => {
    mockFetchResponse({
      claims: [
        {
          text: "Earth is flat",
          claimant: "Some Person",
          claimReview: [
            {
              publisher: { name: "PolitiFact" },
              textualRating: "False",
              url: "https://politifact.com/earth-flat",
            },
          ],
        },
        {
          text: "Earth is round",
          claimant: "Another Person",
          claimReview: [
            {
              publisher: { name: "Snopes" },
              textualRating: "True",
              url: "https://snopes.com/earth-round",
            },
          ],
        },
      ],
    });

    const results = await queryFactCheck(TEST_API_KEY, "earth shape");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      claim: "Earth is flat",
      claimant: "Some Person",
      rating: "False",
      source: "PolitiFact",
      url: "https://politifact.com/earth-flat",
    });
    expect(results[1]).toEqual({
      claim: "Earth is round",
      claimant: "Another Person",
      rating: "True",
      source: "Snopes",
      url: "https://snopes.com/earth-round",
    });
  });

  it("returns empty array when response has no claims", async () => {
    mockFetchResponse({});

    const results = await queryFactCheck(TEST_API_KEY, "something obscure");

    expect(results).toEqual([]);
  });

  it("returns empty array when response has empty claims array", async () => {
    mockFetchResponse({ claims: [] });

    const results = await queryFactCheck(TEST_API_KEY, "something obscure");

    expect(results).toEqual([]);
  });

  it("returns empty array on API error (500)", async () => {
    mockFetchResponse({ error: "Internal Server Error" }, 500);

    const results = await queryFactCheck(TEST_API_KEY, "test claim");

    expect(results).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error"))
    );

    const results = await queryFactCheck(TEST_API_KEY, "test claim");

    expect(results).toEqual([]);
  });

  it("constructs the URL with encoded query and API key", async () => {
    const mockFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal("fetch", mockFn);

    await queryFactCheck(TEST_API_KEY, "is the earth flat?");

    expect(mockFn).toHaveBeenCalledOnce();
    const calledUrl = mockFn.mock.calls[0][0] as string;
    expect(calledUrl).toContain(
      "query=" + encodeURIComponent("is the earth flat?")
    );
    expect(calledUrl).toContain("key=test-google-key");
    expect(calledUrl).toContain("languageCode=en");
    expect(calledUrl).toContain(
      "factchecktools.googleapis.com/v1alpha1/claims:search"
    );
  });

  it("truncates claim text to 200 characters in the query param", async () => {
    const mockFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal("fetch", mockFn);

    const longClaim = "a".repeat(300);
    await queryFactCheck(TEST_API_KEY, longClaim);

    expect(mockFn).toHaveBeenCalledOnce();
    const calledUrl = mockFn.mock.calls[0][0] as string;
    const queryParam = new URL(calledUrl).searchParams.get("query");
    expect(queryParam).toHaveLength(200);
  });

  it("filters out claims without claimReview", async () => {
    mockFetchResponse({
      claims: [
        {
          text: "Valid claim",
          claimant: "Someone",
          claimReview: [
            {
              publisher: { name: "FactCheck.org" },
              textualRating: "True",
              url: "https://factcheck.org/valid",
            },
          ],
        },
        {
          text: "Claim without review",
          claimant: "Nobody",
          claimReview: [],
        },
      ],
    });

    const results = await queryFactCheck(TEST_API_KEY, "test claim");

    expect(results).toHaveLength(1);
    expect(results[0].claim).toBe("Valid claim");
  });
});
