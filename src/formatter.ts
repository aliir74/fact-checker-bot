import { FactCheckResult, Verdict } from "./types";

const VERDICT_EMOJIS: Record<Verdict, string> = {
  "True": "\u2705",
  "Mostly True": "\u2611\uFE0F",
  "Mixed": "\u2696\uFE0F",
  "Mostly False": "\u26A0\uFE0F",
  "False": "\u274C",
  "Satire": "\uD83C\uDFAD",
  "Unverifiable": "\u2753",
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function toHtml(text: string): string {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let result = "";
  let lastIndex = 0;
  let match;

  while ((match = linkRegex.exec(text)) !== null) {
    result += escapeHtml(text.slice(lastIndex, match.index));
    result += `<a href="${escapeHtml(match[2])}">${escapeHtml(match[1])}</a>`;
    lastIndex = match.index + match[0].length;
  }

  result += escapeHtml(text.slice(lastIndex));
  return result;
}

export function formatResponse(result: FactCheckResult, claimText: string): string {
  const emoji = VERDICT_EMOJIS[result.verdict] || "\u2753";
  const sourceLabel = result.sourceType === "fact_check_api"
    ? "Google Fact Check"
    : "AI Analysis";

  const lines: string[] = [
    `${emoji} Verdict: ${escapeHtml(result.verdict)} (${escapeHtml(result.confidence)} Confidence)`,
    "",
    `\uD83D\uDCCB Claim: "${escapeHtml(truncateForDisplay(claimText, 200))}"`,
    "",
    `\uD83D\uDD0D Analysis:`,
    toHtml(result.analysisEn),
    "",
    `\uD83D\uDD0D \u062A\u062D\u0644\u06CC\u0644:`,
    toHtml(result.analysisFa),
  ];

  if (result.sources.length > 0) {
    lines.push("");
    lines.push(`\uD83D\uDCCE Sources:`);
    for (const source of result.sources) {
      lines.push(`- <a href="${escapeHtml(source)}">${escapeHtml(source)}</a>`);
    }
  }

  lines.push("");
  lines.push(`\u26A1 Via ${sourceLabel}`);

  return lines.join("\n");
}

export function formatRateLimitResponse(retryAfterSeconds: number): string {
  return [
    "\u23F3 Please wait a moment before sending another request.",
    `Try again in ~${retryAfterSeconds} seconds.`,
    "",
    "\u23F3 \u0644\u0637\u0641\u0627\u064B \u0686\u0646\u062F \u0644\u062D\u0638\u0647 \u0635\u0628\u0631 \u06A9\u0646\u06CC\u062F.",
    `\u062D\u062F\u0648\u062F ${retryAfterSeconds} \u062B\u0627\u0646\u06CC\u0647 \u062F\u06CC\u06AF\u0631 \u062F\u0648\u0628\u0627\u0631\u0647 \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F.`,
  ].join("\n");
}

export function formatErrorResponse(): string {
  return [
    "\u26A0\uFE0F An error occurred while processing your request. Please try again later.",
    "",
    "\u26A0\uFE0F \u062E\u0637\u0627\u06CC\u06CC \u062F\u0631 \u067E\u0631\u062F\u0627\u0632\u0634 \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0634\u0645\u0627 \u0631\u062E \u062F\u0627\u062F. \u0644\u0637\u0641\u0627\u064B \u0628\u0639\u062F\u0627\u064B \u062F\u0648\u0628\u0627\u0631\u0647 \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F.",
  ].join("\n");
}

export function formatRejectedInputResponse(): string {
  return [
    "Please send text, a screenshot, or a link to fact-check.",
    "",
    "\u0644\u0637\u0641\u0627\u064B \u0645\u062A\u0646\u060C \u0627\u0633\u06A9\u0631\u06CC\u0646\u200C\u0634\u0627\u062A \u06CC\u0627 \u0644\u06CC\u0646\u06A9 \u0627\u0631\u0633\u0627\u0644 \u06A9\u0646\u06CC\u062F.",
  ].join("\n");
}

export function formatWelcomeMessage(): string {
  return [
    "Welcome to Fact Checker Bot!",
    "",
    "Send me a claim to fact-check:",
    "- Text message with a claim",
    "- Screenshot of a social media post",
    "- Link to an article or tweet",
    "",
    "I'll analyze it and provide a bilingual verdict (English + Persian) with sources.",
    "",
    "---",
    "",
    "\u0628\u0647 \u0631\u0628\u0627\u062A \u0631\u0627\u0633\u062A\u06CC\u200C\u0622\u0632\u0645\u0627\u06CC\u06CC \u062E\u0648\u0634 \u0622\u0645\u062F\u06CC\u062F!",
    "",
    "\u06CC\u06A9 \u0627\u062F\u0639\u0627 \u0628\u0631\u0627\u06CC \u0628\u0631\u0631\u0633\u06CC \u0628\u0641\u0631\u0633\u062A\u06CC\u062F:",
    "- \u0645\u062A\u0646 \u0627\u062F\u0639\u0627",
    "- \u0627\u0633\u06A9\u0631\u06CC\u0646\u200C\u0634\u0627\u062A \u0627\u0632 \u067E\u0633\u062A \u0634\u0628\u06A9\u0647 \u0627\u062C\u062A\u0645\u0627\u0639\u06CC",
    "- \u0644\u06CC\u0646\u06A9 \u0645\u0642\u0627\u0644\u0647 \u06CC\u0627 \u062A\u0648\u06CC\u06CC\u062A",
  ].join("\n");
}

export function formatTruncatedNotice(): string {
  return "\n\n\u2702\uFE0F Text was truncated to 2000 characters.";
}

function truncateForDisplay(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + "...";
}
