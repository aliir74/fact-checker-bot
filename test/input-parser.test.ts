import { describe, it, expect } from "vitest";
import { parseInput } from "../src/input-parser";
import { TelegramMessage } from "../src/types";
import { MAX_CLAIM_LENGTH } from "../src/config";

function makeMessage(
  overrides: Partial<TelegramMessage> = {}
): TelegramMessage {
  return {
    message_id: 1,
    chat: { id: 123, type: "private" },
    ...overrides,
  };
}

describe("parseInput", () => {
  it("returns text type for a plain text message", () => {
    const result = parseInput(makeMessage({ text: "The earth is flat" }));
    expect(result).toEqual({ type: "text", text: "The earth is flat" });
  });

  it("returns url type with surroundingText when text contains a URL and extra text", () => {
    const result = parseInput(
      makeMessage({ text: "Check this https://example.com/article please" })
    );
    expect(result).toEqual({
      type: "url",
      url: "https://example.com/article",
      surroundingText: "Check this please",
    });
  });

  it("returns url type without surroundingText when text is only a URL", () => {
    const result = parseInput(
      makeMessage({ text: "https://example.com/article" })
    );
    expect(result).toEqual({
      type: "url",
      url: "https://example.com/article",
    });
  });

  it("returns image type using the highest resolution photo", () => {
    const result = parseInput(
      makeMessage({
        photo: [
          { file_id: "small", width: 90, height: 90 },
          { file_id: "medium", width: 320, height: 320 },
          { file_id: "large", width: 800, height: 800 },
        ],
      })
    );
    expect(result).toEqual({
      type: "image",
      fileId: "large",
      caption: undefined,
    });
  });

  it("returns image type with caption when photo has caption", () => {
    const result = parseInput(
      makeMessage({
        photo: [{ file_id: "photo123", width: 800, height: 600 }],
        caption: "Is this real?",
      })
    );
    expect(result).toEqual({
      type: "image",
      fileId: "photo123",
      caption: "Is this real?",
    });
  });

  it("returns image type for a document with image mime type", () => {
    const result = parseInput(
      makeMessage({
        document: { file_id: "doc123", mime_type: "image/png" },
      })
    );
    expect(result).toEqual({
      type: "image",
      fileId: "doc123",
      caption: undefined,
    });
  });

  it("returns rejected for voice messages", () => {
    const result = parseInput(makeMessage({ voice: {} }));
    expect(result).toEqual({
      type: "rejected",
      reason: "Please send text, a screenshot, or a link.",
    });
  });

  it("returns rejected for video messages", () => {
    const result = parseInput(makeMessage({ video: {} }));
    expect(result).toEqual({
      type: "rejected",
      reason: "Please send text, a screenshot, or a link.",
    });
  });

  it("returns rejected for sticker messages", () => {
    const result = parseInput(makeMessage({ sticker: {} }));
    expect(result).toEqual({
      type: "rejected",
      reason: "Please send text, a screenshot, or a link.",
    });
  });

  it("truncates text longer than MAX_CLAIM_LENGTH and sets truncated flag", () => {
    const longText = "a".repeat(MAX_CLAIM_LENGTH + 500);
    const result = parseInput(makeMessage({ text: longText }));
    expect(result).toEqual({
      type: "text",
      text: "a".repeat(MAX_CLAIM_LENGTH),
      truncated: true,
    });
  });

  it("returns rejected for empty message with no text or photo", () => {
    const result = parseInput(makeMessage());
    expect(result).toEqual({
      type: "rejected",
      reason: "Please send text, a screenshot, or a link.",
    });
  });

  it("ignores document without image mime type and falls through to rejected", () => {
    const result = parseInput(
      makeMessage({
        document: { file_id: "doc456", mime_type: "application/pdf" },
      })
    );
    expect(result).toEqual({
      type: "rejected",
      reason: "Please send text, a screenshot, or a link.",
    });
  });
});
