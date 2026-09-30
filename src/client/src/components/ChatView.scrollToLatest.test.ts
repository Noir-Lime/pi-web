// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatLine } from "./shared";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

const SCROLL_HEIGHT = 10_000;
const CLIENT_HEIGHT = 800;

function lines(start: number, count: number): ChatLine[] {
  return Array.from({ length: count }, (_, index) => ({ role: "user", parts: [{ type: "text", text: `message ${String(start + index)}` }] }));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => { requestAnimationFrame(() => { resolve(); }); });
}

async function settle(view: ChatView): Promise<void> {
  await view.updateComplete;
  for (let index = 0; index < 4; index += 1) await nextFrame();
}

/** happy-dom has no layout: give the transcript scroller a tall, scrollable viewport. */
function stubScroller(view: ChatView, scrollTop = 0): HTMLElement {
  const chat = view.shadowRoot?.querySelector<HTMLElement>(".chat");
  if (chat === null || chat === undefined) throw new Error("ChatView did not render its scroller");
  let top = scrollTop;
  Object.defineProperty(chat, "scrollHeight", { configurable: true, get: () => SCROLL_HEIGHT });
  Object.defineProperty(chat, "clientHeight", { configurable: true, get: () => CLIENT_HEIGHT });
  Object.defineProperty(chat, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => { top = Math.max(0, Math.min(value, chat.scrollHeight - CLIENT_HEIGHT)); },
  });
  return chat;
}

async function mount(sessionId: string, onLoadMore: () => void): Promise<{ view: ChatView; chat: HTMLElement }> {
  const view = new ChatView();
  view.onLoadMore = onLoadMore;
  document.body.append(view);
  await view.updateComplete;
  const chat = stubScroller(view);
  view.sessionId = sessionId;
  view.messageStart = 100;
  view.messageTotal = 150;
  view.hasMore = true;
  view.messages = lines(100, 50);
  await settle(view);
  return { view, chat };
}

function storeStaleAnchor(sessionId: string): void {
  // Legacy device-local anchor pointing at a message that is not in the latest page.
  localStorage.setItem(`pi-web:chat-scroll:${sessionId}`, JSON.stringify({ mode: "anchor", anchorId: "m:3", offset: 12 }));
}

describe("ChatView opens sessions at the latest message", () => {
  it("ignores a stale saved anchor: opens at the bottom and never pages earlier history automatically", async () => {
    storeStaleAnchor("session-1");
    const onLoadMore = vi.fn();
    const { chat } = await mount("session-1", onLoadMore);

    expect(chat.scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("switching or reopening sessions goes to the bottom, not a stale saved anchor", async () => {
    storeStaleAnchor("session-1");
    storeStaleAnchor("session-2");
    const onLoadMore = vi.fn();
    const { view, chat } = await mount("session-1", onLoadMore);

    chat.scrollTop = 5_000;
    chat.dispatchEvent(new Event("scroll"));
    view.sessionId = "session-2";
    await settle(view);
    expect(chat.scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT);

    chat.scrollTop = 5_000;
    chat.dispatchEvent(new Event("scroll"));
    view.sessionId = "session-1";
    await settle(view);
    expect(chat.scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT);

    // Reopening the same session has no sessionId change; the app uses this public transition.
    chat.scrollTop = 5_000;
    chat.dispatchEvent(new Event("scroll"));
    view.scrollToLatest();
    await settle(view);
    expect(chat.scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("keeps the live tail pinned but leaves a reader browsing older messages in place", async () => {
    const { view, chat } = await mount("session-1", vi.fn());
    // Model height growth at render time, not before willUpdate checks the old viewport.
    Object.defineProperty(chat, "scrollHeight", {
      configurable: true,
      get: () => chat.querySelector('article[data-index="151"]') !== null ? 14_000 : chat.querySelector('article[data-index="150"]') !== null ? 12_000 : SCROLL_HEIGHT,
    });
    view.messages = [...view.messages, ...lines(150, 1)];
    await settle(view);
    expect(chat.scrollTop).toBe(12_000 - CLIENT_HEIGHT);

    chat.scrollTop = 5_000;
    chat.dispatchEvent(new Event("scroll"));
    await settle(view);
    view.messages = [...view.messages, ...lines(151, 1)];
    await settle(view);
    expect(chat.scrollTop).toBe(5_000);
  });

  it("still loads earlier history when the user scrolls to the top and anchors the prepended page", async () => {
    const onLoadMore = vi.fn();
    const { view, chat } = await mount("session-1", onLoadMore);
    const prependAnchors: unknown[] = [];
    const restorePrepend = view.restorePrependScrollAnchor.bind(view);
    view.restorePrependScrollAnchor = (anchor) => {
      prependAnchors.push(anchor);
      restorePrepend(anchor);
    };

    chat.scrollTop = 0;
    chat.dispatchEvent(new Event("scroll"));
    await settle(view);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    view.loadingMore = true;
    await view.updateComplete;
    view.messageStart = 50;
    view.messages = [...lines(50, 50), ...view.messages];
    view.loadingMore = false;
    await settle(view);

    expect(prependAnchors).toHaveLength(1);
    // Prepending keeps the reader in older history rather than snapping to the latest message.
    expect(chat.scrollTop).toBeLessThan(SCROLL_HEIGHT - CLIENT_HEIGHT);
  });
});
