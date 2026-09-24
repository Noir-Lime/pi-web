import { describe, expect, it } from "vitest";
import { normalizeMessage } from "../client/src/chatMessages.js";
import type { MessagePage } from "../shared/apiTypes.js";
import { findMediaInMessages, isMediaId, projectBrowserMessage, projectBrowserMessageResponse, projectBrowserSessionEvent } from "./browserMessageProjection.js";

function signedAssistantMessage() {
  return {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "private chain", thinkingSignature: "opaque-provider-payload", redacted: true },
      { type: "text", text: "visible answer", textSignature: "text-metadata" },
      { type: "toolCall", name: "read", arguments: { thinkingSignature: "ordinary nested argument" }, thoughtSignature: "tool-metadata" },
    ],
    model: "model-1",
  };
}

describe("browser message projection", () => {
  it("omits only thinking-block signatures without mutating runtime messages", () => {
    const message = signedAssistantMessage();

    const projected = projectBrowserMessage(message);

    expect(projected).toEqual({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private chain", redacted: true },
        { type: "text", text: "visible answer", textSignature: "text-metadata" },
        { type: "toolCall", name: "read", arguments: { thinkingSignature: "ordinary nested argument" }, thoughtSignature: "tool-metadata" },
      ],
      model: "model-1",
    });
    expect(message.content[0]).toEqual({ type: "thinking", thinking: "private chain", thinkingSignature: "opaque-provider-payload", redacted: true });
    expect(normalizeMessage(projected)).toEqual(normalizeMessage(message));
  });

  it("projects paged history responses", () => {
    const message = signedAssistantMessage();
    const page: MessagePage = { messages: [message], start: 4, total: 5 };

    expect(projectBrowserMessageResponse(page)).toEqual({
      messages: [{ ...message, content: [{ type: "thinking", thinking: "private chain", redacted: true }, ...message.content.slice(1)] }],
      start: 4,
      total: 5,
    });
    expect(page.messages[0]).toBe(message);
  });

  it("projects final-message events but leaves other event shapes untouched", () => {
    const message = signedAssistantMessage();
    const finalEvent = { type: "message.end" as const, message };
    const appendEvent = { type: "message.append" as const, message };

    expect(projectBrowserSessionEvent(finalEvent)).toEqual({
      type: "message.end",
      message: { ...message, content: [{ type: "thinking", thinking: "private chain", redacted: true }, ...message.content.slice(1)] },
    });
    expect(projectBrowserSessionEvent(appendEvent)).toBe(appendEvent);
    expect(finalEvent.message).toBe(message);
  });

  it("leaves images inline unless media references are requested", () => {
    const page: MessagePage = { messages: [{ role: "toolResult", content: [{ type: "image", mimeType: "image/png", data: "A".repeat(100) }] }], start: 0, total: 1 };

    expect(projectBrowserMessageResponse(page)).toBe(page);
  });

  it("replaces only oversized raster images with content-hash references that resolve back", () => {
    const big = { type: "image", mimeType: "image/png", data: "B".repeat(100) };
    const small = { type: "image", mimeType: "image/jpeg", data: "C".repeat(10) };
    const svg = { type: "image", mimeType: "image/svg+xml", data: "D".repeat(100) };
    const message = { role: "toolResult", content: [{ type: "text", text: "read" }, big, small, svg] };
    const page: MessagePage = { messages: [message], start: 7, total: 8 };

    const projected = projectBrowserMessageResponse(page, { inlineLimit: 50 });
    const parts = contentParts(projected.messages[0]);
    const mediaId = parts[1] !== null && typeof parts[1] === "object" && "mediaId" in parts[1] ? String(parts[1].mediaId) : "";

    expect(isMediaId(mediaId)).toBe(true);
    expect(parts[1]).toEqual({ type: "image", mimeType: "image/png", mediaId, byteSize: 75 });
    expect(parts[2]).toBe(small);
    expect(parts[3]).toBe(svg);
    expect(message.content[1]).toBe(big);
    expect(findMediaInMessages(page.messages, mediaId)).toEqual({ mimeType: "image/png", data: big.data });
    expect(findMediaInMessages(page.messages, "0".repeat(64))).toBeUndefined();
  });

  it("never resolves SVG images even when their content hash is known", () => {
    const svg = { type: "image", mimeType: "image/svg+xml", data: "PHN2Zy8+" };
    const page: MessagePage = { messages: [{ role: "user", content: [svg] }], start: 0, total: 1 };
    const pngWithSameData = { messages: [{ role: "user", content: [{ ...svg, mimeType: "image/png" }] }], start: 0, total: 1 };
    const id = contentParts(projectBrowserMessageResponse(pngWithSameData, { inlineLimit: 0 }).messages[0])[0];
    const mediaId = id !== null && typeof id === "object" && "mediaId" in id ? String(id.mediaId) : "";

    expect(findMediaInMessages(page.messages, mediaId)).toBeUndefined();
  });
});

function contentParts(message: unknown): unknown[] {
  if (message === null || typeof message !== "object" || !("content" in message) || !Array.isArray(message.content)) return [];
  const content: unknown[] = message.content;
  return content;
}
