import * as Sentry from "@sentry/cloudflare";
import { FactCheckApiResult } from "./types";

const FACT_CHECK_API_URL =
  "https://factchecktools.googleapis.com/v1alpha1/claims:search";

interface FactCheckApiClaim {
  text: string;
  claimant: string;
  claimReview: Array<{
    publisher: { name: string };
    textualRating: string;
    url: string;
  }>;
}

interface FactCheckApiResponse {
  claims?: FactCheckApiClaim[];
}

export async function queryFactCheck(
  apiKey: string,
  claimText: string
): Promise<FactCheckApiResult[]> {
  try {
    Sentry.addBreadcrumb({
      category: "api",
      message: "Google Fact Check API query",
      level: "info",
    });

    const truncated = claimText.slice(0, 200);
    const url = `${FACT_CHECK_API_URL}?query=${encodeURIComponent(truncated)}&key=${apiKey}&languageCode=en`;

    const response = await fetch(url);

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as FactCheckApiResponse;

    if (!data.claims || data.claims.length === 0) {
      return [];
    }

    return data.claims
      .filter((c) => c.claimReview && c.claimReview.length > 0)
      .map((c) => ({
        claim: c.text,
        claimant: c.claimant,
        rating: c.claimReview[0].textualRating,
        source: c.claimReview[0].publisher.name,
        url: c.claimReview[0].url,
      }));
  } catch {
    return [];
  }
}
