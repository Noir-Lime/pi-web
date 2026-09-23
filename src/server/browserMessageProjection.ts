import { createHash } from "node:crypto";
import type { MessagePage, SessionUiEvent } from "../shared/apiTypes.js";

/** Raster formats safe to serve from the history image route; SVG is excluded because it can carry script. */
const LAZY_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const imageHashes = new WeakMap<object, string>();

/**
 * Remove provider-only thinking data at the browser transport boundary. The
 * runtime message remains unchanged because only affected messages and content
 * blocks are copied.
 */
export function projectBrowserMessage(message: unknown): unknown {
  if (!isRecord(message)) return message;
  const originalContent = message["content"];
  if (!isUnknownArray(originalContent)) return message;

  const content = mapChanged(originalContent, (part) => {
    if (!isRecord(part) || part["type"] !== "thinking" || !Object.hasOwn(part, "thinkingSignature")) return part;
    const projected = { ...part };
    delete projected["thinkingSignature"];
    return projected;
  });

  return content === originalContent ? message : { ...message, content };
}

/**
 * History pages replace inline image data with an `imageId` the browser loads
 * lazily from the session image route, so page size stays independent of how
 * many screenshots the recent turns contain.
 */
export function projectBrowserMessageResponse(response: MessagePage): MessagePage {
  let index = 0;
  const messages = mapChanged(response.messages, (message) => {
    const messageIndex = response.start + index;
    index += 1;
    return withLazyImages(projectBrowserMessage(message), messageIndex);
  });
  return messages === response.messages ? response : { ...response, messages };
}

/** Resolve an `imageId` from {@link projectBrowserMessageResponse} against a history page containing its message. */
export function findHistoryImage(page: MessagePage, imageId: string): { mimeType: string; data: string } | undefined {
  const match = /^(\d+)-(\d+)-([0-9a-f]{16})$/.exec(imageId);
  if (match === null) return undefined;
  const message = page.messages[Number(match[1]) - page.start];
  const content = isRecord(message) ? message["content"] : undefined;
  const part = isUnknownArray(content) ? content[Number(match[2])] : undefined;
  if (!isLazyImagePart(part) || imageHash(part) !== match[3]) return undefined;
  return { mimeType: part.mimeType, data: part.data };
}

function withLazyImages(message: unknown, messageIndex: number): unknown {
  if (!isRecord(message)) return message;
  const originalContent = message["content"];
  if (!isUnknownArray(originalContent)) return message;
  let partIndex = 0;
  const content = mapChanged(originalContent, (part) => {
    const current = partIndex;
    partIndex += 1;
    if (!isLazyImagePart(part)) return part;
    const projected: Record<string, unknown> = { ...part, imageId: `${String(messageIndex)}-${String(current)}-${imageHash(part)}` };
    delete projected["data"];
    return projected;
  });
  return content === originalContent ? message : { ...message, content };
}

function isLazyImagePart(part: unknown): part is Record<string, unknown> & { mimeType: string; data: string } {
  return isRecord(part)
    && part["type"] === "image"
    && typeof part["data"] === "string"
    && part["data"] !== ""
    && typeof part["mimeType"] === "string"
    && LAZY_IMAGE_MIME_TYPES.has(part["mimeType"]);
}

function imageHash(part: Record<string, unknown> & { data: string }): string {
  const cached = imageHashes.get(part);
  if (cached !== undefined) return cached;
  const hash = createHash("sha256").update(part.data).digest("hex").slice(0, 16);
  imageHashes.set(part, hash);
  return hash;
}

export function projectBrowserSessionEvent(event: SessionUiEvent): SessionUiEvent {
  if (event.type !== "message.end" || event.message === undefined) return event;
  const message = projectBrowserMessage(event.message);
  return message === event.message ? event : { ...event, message };
}

function mapChanged<T>(values: T[], project: (value: T) => T): T[] {
  let projectedValues: T[] | undefined;
  let index = 0;
  for (const value of values) {
    const projected = project(value);
    if (projectedValues === undefined) {
      if (projected === value) {
        index += 1;
        continue;
      }
      projectedValues = values.slice(0, index);
    }
    projectedValues.push(projected);
    index += 1;
  }
  return projectedValues ?? values;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
