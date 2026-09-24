import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionsApi } from "./clients";
import { MAX_INLINE_MEDIA_BASE64_LENGTH } from "./urls";

const session = { id: "s 1", cwd: "/repo" };

beforeEach(() => {
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("history media references", () => {
  it("opts into media references and turns each one into a hinted, machine-scoped image URL", async () => {
    const mediaId = "b".repeat(64);
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn((input: string) => { requestedUrls.push(input); return Promise.resolve(new Response(JSON.stringify({
      messages: [
        { role: "user", content: [{ type: "text", text: "look" }] },
        { role: "toolResult", content: [{ type: "image", mimeType: "image/png", mediaId, byteSize: 1000 }, { type: "image", mimeType: "image/png", data: "QUJD" }] },
      ],
      start: 40,
      total: 42,
    }))); });
    vi.stubGlobal("fetch", fetchMock);

    const page = await sessionsApi.messages(session, { limit: 100 }, "remote 1");

    const requested = new URL(requestedUrls[0] ?? "");
    expect(requested.searchParams.get("maxInlineMedia")).toBe(String(MAX_INLINE_MEDIA_BASE64_LENGTH));
    expect(page.messages[1]).toEqual({
      role: "toolResult",
      content: [
        {
          type: "image",
          mimeType: "image/png",
          mediaId,
          byteSize: 1000,
          url: `https://pi.example.test/api/machines/remote%201/sessions/s%201/media/${mediaId}?cwd=%2Frepo&at=41`,
        },
        { type: "image", mimeType: "image/png", data: "QUJD" },
      ],
    });
  });
});
