import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractUrlContent,
  stripHtml,
  decodeHtmlEntities,
  extractTitle,
} from "../src/url-extractor";

// Save original fetch to restore later
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(response: {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}) {
  const mockFn = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: response.json ?? (() => Promise.resolve({})),
    text: response.text ?? (() => Promise.resolve("")),
  });
  globalThis.fetch = mockFn;
  return mockFn;
}

describe("extractUrlContent", () => {
  it("rewrites twitter.com URL to fxtwitter API and returns tweet content", async () => {
    const fetchMock = mockFetch({
      json: () =>
        Promise.resolve({
          tweet: {
            text: "This is a tweet about vaccines",
            author: { name: "Dr. Example" },
          },
        }),
    });

    const result = await extractUrlContent(
      "https://twitter.com/user/status/123456789"
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.fxtwitter.com/user/status/123456789"
    );
    expect(result).toEqual({
      title: "",
      text: "This is a tweet about vaccines",
      author: "Dr. Example",
    });
  });

  it("rewrites x.com URL to fxtwitter API", async () => {
    const fetchMock = mockFetch({
      json: () =>
        Promise.resolve({
          tweet: {
            text: "Tweet from X",
            author: { name: "X User" },
          },
        }),
    });

    const result = await extractUrlContent(
      "https://x.com/someone/status/987654321"
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.fxtwitter.com/someone/status/987654321"
    );
    expect(result).toEqual({
      title: "",
      text: "Tweet from X",
      author: "X User",
    });
  });

  it("returns error for failed twitter fetch", async () => {
    mockFetch({ ok: false, status: 404 });

    const result = await extractUrlContent(
      "https://twitter.com/user/status/000"
    );

    expect(result).toEqual({ title: "", text: "", error: true });
  });

  it("fetches and strips HTML for generic URLs", async () => {
    mockFetch({
      text: () =>
        Promise.resolve(
          "<html><head><title>Test Page</title></head><body><p>Hello world</p></body></html>"
        ),
    });

    const result = await extractUrlContent("https://example.com/article");

    expect(result).toEqual({
      title: "Test Page",
      text: "Hello world",
    });
  });

  it("returns error when generic fetch fails", async () => {
    mockFetch({ ok: false, status: 500 });

    const result = await extractUrlContent("https://example.com/broken");

    expect(result).toEqual({ title: "", text: "", error: true });
  });

  it("returns error when fetch throws", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await extractUrlContent("https://example.com/timeout");

    expect(result).toEqual({ title: "", text: "", error: true });
  });

  it("truncates long HTML content to 2000 chars", async () => {
    const longContent = "a".repeat(3000);
    mockFetch({
      text: () =>
        Promise.resolve(
          `<html><head><title>Long</title></head><body>${longContent}</body></html>`
        ),
    });

    const result = await extractUrlContent("https://example.com/long");

    expect(result.text.length).toBe(2000);
    expect(result.title).toBe("Long");
  });
});

describe("stripHtml", () => {
  it("removes script tags and their content", () => {
    const html =
      '<p>Hello</p><script>alert("xss")</script><p>World</p>';
    expect(stripHtml(html)).toBe("Hello World");
  });

  it("removes style tags and their content", () => {
    const html =
      "<p>Hello</p><style>body { color: red; }</style><p>World</p>";
    expect(stripHtml(html)).toBe("Hello World");
  });

  it("strips all HTML tags", () => {
    const html = "<div><span>Text</span> <a href='#'>link</a></div>";
    expect(stripHtml(html)).toBe("Text link");
  });

  it("collapses whitespace", () => {
    const html = "<p>Hello</p>   \n\n  <p>World</p>";
    expect(stripHtml(html)).toBe("Hello World");
  });

  it("decodes HTML entities in stripped text", () => {
    const html = "<p>Tom &amp; Jerry &lt;3&gt;</p>";
    expect(stripHtml(html)).toBe("Tom & Jerry <3>");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes &amp;", () => {
    expect(decodeHtmlEntities("&amp;")).toBe("&");
  });

  it("decodes &lt; and &gt;", () => {
    expect(decodeHtmlEntities("&lt;div&gt;")).toBe("<div>");
  });

  it("decodes &quot;", () => {
    expect(decodeHtmlEntities("&quot;hello&quot;")).toBe('"hello"');
  });

  it("decodes &#39;", () => {
    expect(decodeHtmlEntities("it&#39;s")).toBe("it's");
  });

  it("decodes multiple entities in one string", () => {
    expect(decodeHtmlEntities("a &amp; b &lt; c &gt; d")).toBe(
      "a & b < c > d"
    );
  });
});

describe("extractTitle", () => {
  it("extracts title from HTML", () => {
    expect(extractTitle("<title>My Page</title>")).toBe("My Page");
  });

  it("returns empty string when no title tag", () => {
    expect(extractTitle("<html><body>no title</body></html>")).toBe("");
  });

  it("decodes entities in title", () => {
    expect(extractTitle("<title>Tom &amp; Jerry</title>")).toBe(
      "Tom & Jerry"
    );
  });
});
