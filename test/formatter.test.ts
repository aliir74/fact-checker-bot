import { describe, it, expect } from "vitest";
import {
  formatResponse,
  formatRateLimitResponse,
  formatErrorResponse,
  formatRejectedInputResponse,
  formatTruncatedNotice,
  escapeHtml,
  toHtml,
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
  it("formats a complete fact-check response with HTML", () => {
    const result = makeResult();
    const text = formatResponse(result, "Test claim");

    expect(text).toContain("Verdict: False (High Confidence)");
    expect(text).toContain("Claim:");
    expect(text).toContain("Test claim");
    expect(text).toContain("Analysis:");
    expect(text).toContain("This claim is false");
    expect(text).toContain("\u062A\u062D\u0644\u06CC\u0644:");
    expect(text).toContain('<a href="https://source1.com">https://source1.com</a>');
    expect(text).toContain('<a href="https://source2.com">https://source2.com</a>');
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

  it("escapes HTML special chars in analysis text", () => {
    const result = makeResult({
      analysisEn: "Claims about A & B are <disputed>.",
    });
    const text = formatResponse(result, "claim");
    expect(text).toContain("A &amp; B are &lt;disputed&gt;");
  });

  it("converts markdown links in analysis to HTML anchors", () => {
    const result = makeResult({
      analysisEn: "According to [OhMyNews](https://ohmynews.com/article) the claim is false.",
    });
    const text = formatResponse(result, "claim");
    expect(text).toContain('<a href="https://ohmynews.com/article">OhMyNews</a>');
    expect(text).not.toContain("[OhMyNews]");
  });

  it("escapes HTML in claim text", () => {
    const result = makeResult();
    const text = formatResponse(result, "A & B <test>");
    expect(text).toContain("A &amp; B &lt;test&gt;");
  });

  it("handles source URLs with query params", () => {
    const result = makeResult({
      sources: ["https://example.com/page?a=1&b=2"],
    });
    const text = formatResponse(result, "claim");
    expect(text).toContain('<a href="https://example.com/page?a=1&amp;b=2">https://example.com/page?a=1&amp;b=2</a>');
  });
});

describe("escapeHtml", () => {
  it("escapes &, <, >, and double quotes", () => {
    expect(escapeHtml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("leaves normal text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("toHtml", () => {
  it("converts markdown links to HTML anchors", () => {
    expect(toHtml("see [Google](https://google.com) for details")).toBe(
      'see <a href="https://google.com">Google</a> for details'
    );
  });

  it("escapes HTML in surrounding text", () => {
    expect(toHtml("A & B [link](https://example.com) C < D")).toBe(
      'A &amp; B <a href="https://example.com">link</a> C &lt; D'
    );
  });

  it("handles multiple markdown links", () => {
    const input = "[A](https://a.com) and [B](https://b.com)";
    const expected = '<a href="https://a.com">A</a> and <a href="https://b.com">B</a>';
    expect(toHtml(input)).toBe(expected);
  });

  it("returns escaped text when no links present", () => {
    expect(toHtml("plain text with <angle> & ampersand")).toBe(
      "plain text with &lt;angle&gt; &amp; ampersand"
    );
  });

  it("escapes HTML in link text", () => {
    expect(toHtml("[A & B](https://example.com)")).toBe(
      '<a href="https://example.com">A &amp; B</a>'
    );
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
