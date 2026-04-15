import { describe, it, expect } from "vitest";
import {
  formatResponse,
  formatRateLimitResponse,
  formatErrorResponse,
  formatRejectedInputResponse,
  formatTruncatedNotice,
} from "../src/formatter";
import { FactCheckResult } from "../src/types";

function makeResult(overrides: Partial<FactCheckResult> = {}): FactCheckResult {
  return {
    verdict: "False",
    confidence: "High",
    analysisEn: "This claim is false based on evidence.",
    analysisFa: "\u0627\u06CC\u0646 \u0627\u062F\u0639\u0627 \u0646\u0627\u062F\u0631\u0633\u062A \u0627\u0633\u062A.",
    sources: ["https://source1.com", "https://source2.com"],
    sourceType: "ai_analysis",
    claimText: "Test claim",
    ...overrides,
  };
}

describe("formatResponse", () => {
  it("formats a complete fact-check response", () => {
    const result = makeResult();
    const text = formatResponse(result, "Test claim");

    expect(text).toContain("Verdict: False (High Confidence)");
    expect(text).toContain("Claim:");
    expect(text).toContain("Test claim");
    expect(text).toContain("Analysis:");
    expect(text).toContain("This claim is false");
    expect(text).toContain("\u062A\u062D\u0644\u06CC\u0644:");
    expect(text).toContain("source1.com");
    expect(text).toContain("source2.com");
    expect(text).toContain("AI Analysis");
  });

  it("shows correct emoji for True verdict", () => {
    const result = makeResult({ verdict: "True" });
    const text = formatResponse(result, "claim");
    expect(text).toContain("\u2705");
  });

  it("shows correct emoji for False verdict", () => {
    const result = makeResult({ verdict: "False" });
    const text = formatResponse(result, "claim");
    expect(text).toContain("\u274C");
  });

  it("shows correct emoji for Mostly True verdict", () => {
    const result = makeResult({ verdict: "Mostly True" });
    const text = formatResponse(result, "claim");
    expect(text).toContain("\u2611\uFE0F");
  });

  it("shows correct emoji for Satire verdict", () => {
    const result = makeResult({ verdict: "Satire" });
    const text = formatResponse(result, "claim");
    expect(text).toContain("\uD83C\uDFAD");
  });

  it("shows correct emoji for Unverifiable verdict", () => {
    const result = makeResult({ verdict: "Unverifiable" });
    const text = formatResponse(result, "claim");
    expect(text).toContain("\u2753");
  });

  it("shows Google Fact Check label when sourceType is fact_check_api", () => {
    const result = makeResult({ sourceType: "fact_check_api" });
    const text = formatResponse(result, "claim");
    expect(text).toContain("Google Fact Check");
  });

  it("omits sources section when no sources", () => {
    const result = makeResult({ sources: [] });
    const text = formatResponse(result, "claim");
    expect(text).not.toContain("Sources:");
  });

  it("truncates long claim text for display", () => {
    const longClaim = "x".repeat(300);
    const result = makeResult();
    const text = formatResponse(result, longClaim);
    expect(text).toContain("...");
  });
});

describe("formatRateLimitResponse", () => {
  it("includes retry seconds in English and Persian", () => {
    const text = formatRateLimitResponse(30);
    expect(text).toContain("30");
    expect(text).toContain("Please wait");
    expect(text).toContain("\u0644\u0637\u0641\u0627\u064B");
  });
});

describe("formatErrorResponse", () => {
  it("returns bilingual error message", () => {
    const text = formatErrorResponse();
    expect(text).toContain("error occurred");
    expect(text).toContain("\u062E\u0637\u0627");
  });
});

describe("formatRejectedInputResponse", () => {
  it("returns bilingual rejection message", () => {
    const text = formatRejectedInputResponse();
    expect(text).toContain("text, a screenshot, or a link");
    expect(text).toContain("\u0644\u0637\u0641\u0627\u064B");
  });
});

describe("formatTruncatedNotice", () => {
  it("mentions truncation", () => {
    const text = formatTruncatedNotice();
    expect(text).toContain("truncated");
    expect(text).toContain("2000");
  });
});
