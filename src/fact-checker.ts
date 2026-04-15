import { Env } from "./config";
import { hashClaim, getCachedClaim, setCachedClaim } from "./cache";
import { queryFactCheck } from "./fact-check-api";
import { extractTextFromImage, analyzeClaimWithGrounding } from "./openrouter";
import { extractUrlContent } from "./url-extractor";
import { getFileUrl } from "./telegram";
import { ClaimInput, FactCheckResult, CachedClaim } from "./types";

export async function factCheck(
  env: Env,
  claim: ClaimInput
): Promise<{ result: FactCheckResult; fromCache: boolean }> {
  const claimText = await resolveClaimText(env, claim);

  if (!claimText) {
    return {
      result: {
        verdict: "Unverifiable",
        confidence: "Low",
        analysisEn: "Could not extract text from the provided input.",
        analysisFa: "\u0646\u062A\u0648\u0627\u0646\u0633\u062A\u06CC\u0645 \u0645\u062A\u0646\u06CC \u0627\u0632 \u0648\u0631\u0648\u062F\u06CC \u0627\u0631\u0627\u0626\u0647\u200C\u0634\u062F\u0647 \u0627\u0633\u062A\u062E\u0631\u0627\u062C \u06A9\u0646\u06CC\u0645.",
        sources: [],
        sourceType: "ai_analysis",
        claimText: "",
      },
      fromCache: false,
    };
  }

  // Check cache
  const claimHash = await hashClaim(claimText);
  const cached = await getCachedClaim(env.DB, claimHash);

  if (cached) {
    return {
      result: cachedToResult(cached, claimText),
      fromCache: true,
    };
  }

  // Query Google Fact Check API
  const factCheckResults = await queryFactCheck(
    env.GOOGLE_FACT_CHECK_API_KEY,
    claimText
  );

  // LLM analysis (with or without fact-check context)
  const result = await analyzeClaimWithGrounding(
    env.OPENROUTER_API_KEY,
    claimText,
    factCheckResults.length > 0 ? factCheckResults : undefined
  );

  // Update sourceType based on fact-check results
  if (factCheckResults.length > 0) {
    result.sourceType = "fact_check_api";
  }

  // Cache the result
  await setCachedClaim(env.DB, {
    claim_hash: claimHash,
    claim_text: claimText,
    verdict: result.verdict,
    confidence: result.confidence,
    analysis_en: result.analysisEn,
    analysis_fa: result.analysisFa,
    sources: JSON.stringify(result.sources),
    source_type: result.sourceType,
    created_at: new Date().toISOString(),
  });

  return { result, fromCache: false };
}

async function resolveClaimText(
  env: Env,
  claim: ClaimInput
): Promise<string | null> {
  switch (claim.type) {
    case "text":
      return claim.text;

    case "image": {
      const fileUrl = await getFileUrl(env.TELEGRAM_BOT_TOKEN, claim.fileId);
      const extracted = await extractTextFromImage(
        env.OPENROUTER_API_KEY,
        fileUrl
      );
      if (!extracted) {
        return claim.caption || null;
      }
      return claim.caption ? `${claim.caption}\n\n${extracted}` : extracted;
    }

    case "url": {
      const content = await extractUrlContent(claim.url);
      if (content.error || !content.text) {
        return claim.surroundingText || null;
      }
      const parts: string[] = [];
      if (claim.surroundingText) {
        parts.push(claim.surroundingText);
      }
      if (content.author) {
        parts.push(`[${content.author}]`);
      }
      parts.push(content.text);
      return parts.join("\n\n");
    }

    case "rejected":
      return null;
  }
}

function cachedToResult(cached: CachedClaim, claimText: string): FactCheckResult {
  let sources: string[] = [];
  if (cached.sources) {
    try {
      sources = JSON.parse(cached.sources);
    } catch {
      sources = [];
    }
  }

  return {
    verdict: cached.verdict as FactCheckResult["verdict"],
    confidence: cached.confidence as FactCheckResult["confidence"],
    analysisEn: cached.analysis_en || "",
    analysisFa: cached.analysis_fa || "",
    sources,
    sourceType: cached.source_type as FactCheckResult["sourceType"],
    claimText,
  };
}
