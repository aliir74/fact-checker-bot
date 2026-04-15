import {
  FactCheckResult,
  FactCheckApiResult,
  Verdict,
  Confidence,
} from "./types";

const VISION_MODEL = "google/gemini-2.0-flash-001";
const ANALYSIS_MODEL = "google/gemini-2.5-flash-preview-04-17";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const ANALYSIS_SYSTEM_PROMPT = `You are a professional fact-checker. Analyze the following claim using web search to find current, reliable evidence.

Instructions:
1. Search for evidence about this claim from reputable sources.
2. Evaluate source credibility (prefer: official statistics, established news agencies, academic sources, fact-checking organizations).
3. Assign a verdict: True / Mostly True / Mixed / Mostly False / False / Satire / Unverifiable
4. Assign confidence: High / Medium / Low
5. Provide a concise analysis (2-3 paragraphs) explaining your reasoning with specific evidence.
6. List all sources with URLs.
7. Provide the analysis in TWO languages:
   - First in the SAME language as the claim
   - Then in Persian (Farsi)
   If the claim is already in Persian, provide the analysis in Persian with key English terms preserved.

Respond in this exact JSON format:
{
  "verdict": "True | Mostly True | Mixed | Mostly False | False | Satire | Unverifiable",
  "confidence": "High | Medium | Low",
  "analysis_original": "Analysis in the claim's original language",
  "analysis_fa": "تحلیل به فارسی",
  "sources": ["https://source1.com", "https://source2.com"]
}`;

const VALID_VERDICTS: Verdict[] = [
  "True",
  "Mostly True",
  "Mixed",
  "Mostly False",
  "False",
  "Satire",
  "Unverifiable",
];

const VALID_CONFIDENCES: Confidence[] = ["High", "Medium", "Low"];

function parseVerdict(v: string): Verdict {
  if (VALID_VERDICTS.includes(v as Verdict)) {
    return v as Verdict;
  }
  return "Unverifiable";
}

function parseConfidence(c: string): Confidence {
  if (VALID_CONFIDENCES.includes(c as Confidence)) {
    return c as Confidence;
  }
  return "Low";
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://fact-checker-bot.workers.dev",
    "X-Title": "Fact Checker Bot",
  };
}

function buildUserMessage(
  claimText: string,
  factCheckResults?: FactCheckApiResult[]
): string {
  let message = `Claim to fact-check:\n\n${claimText}`;

  if (factCheckResults && factCheckResults.length > 0) {
    message += "\n\nExisting fact-checks from established organizations:\n";
    for (const result of factCheckResults) {
      message += `- ${result.source}: rated "${result.rating}" — ${result.url}\n`;
    }
  }

  return message;
}

export async function extractTextFromImage(
  apiKey: string,
  imageUrl: string
): Promise<string> {
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageUrl } },
              {
                type: "text",
                text: "Extract all text from this image exactly as written. If it is a social media post screenshot, include the author name and post text.",
              },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      return "";
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return data.choices?.[0]?.message?.content || "";
  } catch {
    return "";
  }
}

export async function analyzeClaimWithGrounding(
  apiKey: string,
  claimText: string,
  factCheckResults?: FactCheckApiResult[]
): Promise<FactCheckResult> {
  try {
    const userMessage = buildUserMessage(claimText, factCheckResults);

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        messages: [
          { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        plugins: [{ id: "web" }],
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      return buildDefaultResult(
        claimText,
        `API returned status ${response.status}`,
        factCheckResults
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return buildDefaultResult(
        claimText,
        "No content in API response",
        factCheckResults
      );
    }

    const parsed = JSON.parse(content) as {
      verdict?: string;
      confidence?: string;
      analysis_original?: string;
      analysis_fa?: string;
      sources?: string[];
    };

    return {
      verdict: parseVerdict(parsed.verdict || ""),
      confidence: parseConfidence(parsed.confidence || ""),
      analysisEn: parsed.analysis_original || "",
      analysisFa: parsed.analysis_fa || "",
      sources: parsed.sources || [],
      sourceType: factCheckResults?.length ? "fact_check_api" : "ai_analysis",
      claimText,
    };
  } catch {
    return buildDefaultResult(
      claimText,
      "Failed to analyze claim",
      factCheckResults
    );
  }
}

function buildDefaultResult(
  claimText: string,
  errorMessage: string,
  factCheckResults?: FactCheckApiResult[]
): FactCheckResult {
  return {
    verdict: "Unverifiable",
    confidence: "Low",
    analysisEn: errorMessage,
    analysisFa: errorMessage,
    sources: [],
    sourceType: factCheckResults?.length ? "fact_check_api" : "ai_analysis",
    claimText,
  };
}
