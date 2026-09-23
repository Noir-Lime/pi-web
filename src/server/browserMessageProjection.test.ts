import { describe, expect, it } from "vitest";
import { normalizeMessage } from "../client/src/chatMessages.js";
import type { MessagePage } from "../shared/apiTypes.js";
import { findHistoryImage, projectBrowserMessage, projectBrowserMessageResponse, projectBrowserSessionEvent } from "./browserMessageProjection.js";

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

  it("replaces raster history image data with ids that resolve back to the image", () => {
    const png = { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" };
    const svg = { type: "image", mimeType: "image/svg+xml", data: "PHN2Zy8+" };
    const message = { role: "toolResult", content: [{ type: "text", text: "read" }, png, svg] };
    const page: MessagePage = { messages: [message], start: 7, total: 8 };

    const projected = projectBrowserMessageResponse(page);
    const parts = contentParts(projected.messages[0]);
    const imageId = parts[1] !== null && typeof parts[1] === "object" && "imageId" in parts[1] ? String(parts[1].imageId) : "";

    expect(imageId).toMatch(/^7-1-[0-9a-f]{16}$/);
    expect(parts[1]).toEqual({ type: "image", mimeType: "image/png", imageId });
    expect(parts[2]).toBe(svg);
    expect(message.content[1]).toBe(png);
    expect(findHistoryImage(page, imageId)).toEqual({ mimeType: "image/png", data: png.data });
    expect(findHistoryImage(page, "7-1-0000000000000000")).toBeUndefined();
    expect(findHistoryImage(page, "7-2-0000000000000000")).toBeUndefined();
  });
});

function contentParts(message: unknown): unknown[] {
  if (message === null || typeof message !== "object" || !("content" in message) || !Array.isArray(message.content)) return [];
  const content: unknown[] = message.content;
  return content;
}
