import { ClaimInput, TelegramMessage } from "./types";
import { MAX_CLAIM_LENGTH } from "./config";

export function parseInput(message: TelegramMessage): ClaimInput {
  // 1. Photo message — pick the last element (highest resolution)
  if (message.photo && message.photo.length > 0) {
    const highestRes = message.photo[message.photo.length - 1];
    return {
      type: "image",
      fileId: highestRes.file_id,
      caption: message.caption,
    };
  }

  // 2. Document with image mime type
  if (message.document && message.document.mime_type?.startsWith("image/")) {
    return {
      type: "image",
      fileId: message.document.file_id,
      caption: message.caption,
    };
  }

  // 3. Unsupported media types
  if (message.voice || message.video || message.sticker) {
    return {
      type: "rejected",
      reason: "Please send text, a screenshot, or a link.",
    };
  }

  // 4. Bot commands
  if (message.text && message.text.startsWith("/")) {
    return { type: "command", command: message.text.split(" ")[0].split("@")[0] };
  }

  // 5. Text message
  if (message.text) {
    const urlRegex = /https?:\/\/\S+/g;
    const urls = message.text.match(urlRegex);

    if (urls && urls.length > 0) {
      const firstUrl = urls[0];
      const textWithoutUrl = message.text
        .replace(firstUrl, "")
        .replace(/\s+/g, " ")
        .trim();

      if (textWithoutUrl.length > 0) {
        return {
          type: "url",
          url: firstUrl,
          surroundingText: textWithoutUrl,
        };
      }

      return {
        type: "url",
        url: firstUrl,
      };
    }

    // No URL — plain text
    if (message.text.length > MAX_CLAIM_LENGTH) {
      return {
        type: "text",
        text: message.text.slice(0, MAX_CLAIM_LENGTH),
        truncated: true,
      };
    }

    return {
      type: "text",
      text: message.text,
    };
  }

  // 5. Fallback — no recognized content
  return {
    type: "rejected",
    reason: "Please send text, a screenshot, or a link.",
  };
}
