import { MAX_CLAIM_LENGTH } from "./config";

export interface ExtractedContent {
  title: string;
  text: string;
  author?: string;
  error?: boolean;
}

export function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].trim()) : "";
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function stripHtml(html: string): string {
  let cleaned = html;

  // Remove <head>...</head> tags (includes title, meta, etc.)
  cleaned = cleaned.replace(/<head[\s\S]*?<\/head>/gi, "");

  // Remove <script>...</script> tags
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, " ");

  // Remove <style>...</style> tags
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, " ");

  // Strip all remaining HTML tags (replace with space to avoid merging words)
  cleaned = cleaned.replace(/<[^>]+>/g, " ");

  // Decode HTML entities
  cleaned = decodeHtmlEntities(cleaned);

  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, " ");

  // Trim
  cleaned = cleaned.trim();

  return cleaned;
}

export async function extractUrlContent(
  url: string
): Promise<ExtractedContent> {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Twitter/X URL handling
    if (hostname.includes("twitter.com") || hostname.includes("x.com")) {
      return await extractTwitterContent(parsed);
    }

    // Generic URL handling
    return await extractGenericContent(url);
  } catch {
    return { title: "", text: "", error: true };
  }
}

async function extractTwitterContent(
  parsed: URL
): Promise<ExtractedContent> {
  try {
    const fxUrl = `https://api.fxtwitter.com${parsed.pathname}`;
    const response = await fetch(fxUrl);

    if (!response.ok) {
      return { title: "", text: "", error: true };
    }

    const data = (await response.json()) as {
      tweet?: {
        text?: string;
        author?: { name?: string };
      };
    };

    return {
      title: "",
      text: data.tweet?.text ?? "",
      author: data.tweet?.author?.name,
    };
  } catch {
    return { title: "", text: "", error: true };
  }
}

async function extractGenericContent(url: string): Promise<ExtractedContent> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 FactCheckerBot/1.0",
      },
    });

    if (!response.ok) {
      return { title: "", text: "", error: true };
    }

    const html = await response.text();
    const title = extractTitle(html);
    let text = stripHtml(html);

    // Truncate to MAX_CLAIM_LENGTH
    if (text.length > MAX_CLAIM_LENGTH) {
      text = text.slice(0, MAX_CLAIM_LENGTH);
    }

    return { title, text };
  } catch {
    return { title: "", text: "", error: true };
  }
}
