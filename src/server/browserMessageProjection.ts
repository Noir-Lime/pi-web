import { createHash } from "node:crypto";
import type { MessagePage, SessionUiEvent } from "../shared/apiTypes.js";

/** Raster formats safe to serve as raw bytes from the media route; SVG stays inline because it can carry script. */
const LAZY_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MEDIA_ID_PATTERN = /^[0-9a-f]{64}$/u;
const imageHashes = new WeakMap<object, string>();

/**
 * Request-level opt-in for media references: image parts whose inline base64 is
 * longer than `inlineLimit` are replaced by a content-hash `mediaId`. Without it
 * responses are unchanged, so clients that do not ask keep full inline images.
 */
export interface BrowserMediaProjection {
  inlineLimit: number;
}

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
 * Project a history page for the browser. With a media projection, oversized
 * raster images become `{ type, mimeType, mediaId, byteSize }` references the
 * browser loads lazily from the session media route, so page size stays
 * independent of how many screenshots the recent turns contain.
 */
export function projectBrowserMessageResponse(response: MessagePage, media?: BrowserMediaProjection): MessagePage {
  const messages = mapChanged(response.messages, (message) => {
    const projected = projectBrowserMessage(message);
    return media === undefined ? projected : withMediaReferences(projected, media);
  });
  return messages === response.messages ? response : { ...response, messages };
}

export function isMediaId(value: string): boolean {
  return MEDIA_ID_PATTERN.test(value);
}

/** Find a servable raster image by content hash among a page's messages. */
export function findMediaInMessages(messages: readonly unknown[], mediaId: string): { mimeType: string; data: string } | undefined {
  for (const message of messages) {
    const content = isRecord(message) ? message["content"] : undefined;
    if (!isUnknownArray(content)) continue;
    for (const part of content) {
      if (isLazyImagePart(part) && imageHash(part) === mediaId) return { mimeType: part.mimeType, data: part.data };
    }
  }
  return undefined;
}

function withMediaReferences(message: unknown, media: BrowserMediaProjection): unknown {
  if (!isRecord(message)) return message;
  const originalContent = message["content"];
  if (!isUnknownArray(originalContent)) return message;
  const content = mapChanged(originalContent, (part) => {
    if (!isLazyImagePart(part) || part.data.length <= media.inlineLimit) return part;
    const projected: Record<string, unknown> = { ...part, mediaId: imageHash(part), byteSize: Math.floor((part.data.length * 3) / 4) };
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
  const hash = createHash("sha256").update(part.data).digest("hex");
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
