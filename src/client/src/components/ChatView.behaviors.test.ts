// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHAT_BEHAVIORS, type ChatBehaviors } from "../chatBehaviors";
import { MANUAL_CHAT_BEHAVIORS } from "../chatBehaviors.testSupport";
import { groupStorageKey } from "../chatDisclosure";
import { ChatView } from "./ChatView";
import type { ChatLine } from "./shared";
import type { TranscriptImage } from "./TranscriptImage";
import { nativeImage, settleImage } from "./imagePresentation.testSupport";

const messages: ChatLine[] = [
  { role: "assistant", parts: [{ type: "thinking", text: "A technical body" }] },
  { role: "assistant", source: "compaction", parts: [{ type: "image", mimeType: "image/png", data: "QUJD" }] },
  { role: "assistant", parts: [{ type: "text", text: "A normal reply" }] },
];
let frames: Map<number, FrameRequestCallback>;
let frameId: number;

beforeEach(() => {
  vi.useFakeTimers();
  frames = new Map(); frameId = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    frameId += 1; frames.set(frameId, callback); return frameId;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { frames.delete(id); }));
});
afterEach(() => {
  document.body.replaceChildren(); localStorage.clear();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function mount(behaviors: ChatBehaviors = DEFAULT_CHAT_BEHAVIORS) {
  const view = new ChatView();
  view.behaviors = behaviors; view.sessionId = "behaviors-test";
  view.messageTotal = messages.length; view.messages = messages;
  document.body.append(view); await view.updateComplete;
  return view;
}
function required(root: ParentNode, selector: string): HTMLElement {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`Expected ${selector}`);
  return node;
}
function flushFrames(): void {
  const batch = [...frames.values()]; frames.clear();
  for (const callback of batch) callback(0);
}

// Controlled collaborators prove effects; happy-dom provides no real geometry.
function scrollingViewport(view: ChatView, initialTop = 2445) {
  const chat = required(view.renderRoot, ".chat");
  let top = initialTop;
  const write = vi.fn((value: number) => { top = Math.max(0, Math.min(value, 5700)); });
  Object.defineProperties(chat, {
    clientHeight: { value: 300 }, scrollHeight: { value: 6000 },
    scrollTop: { get: () => top, set: write },
  });
  return { chat, write, move: (value: number) => { top = value; chat.dispatchEvent(new Event("scroll")); } };
}

describe("composable normal chat", () => {
  it("keeps default conveniences and explicit small navigation controls, without a meter", async () => {
    const view = await mount();
    expect(view.behaviors.rememberPosition).toBe(true);
    expect(view.behaviors.followTail).toBe(true);
    expect(view.behaviors.automaticHistory).toBe(true);
    expect(view.renderRoot.querySelector("conversation-meter, .scroll-marker")).toBeNull();
    expect(required(view.renderRoot, '.chat-jumps [aria-label="Jump to top"]').textContent).toBe("↑");
    expect(required(view.renderRoot, '.chat-jumps [aria-label="Jump to end"]').textContent).toBe("↓");
  });

  it("keeps closed disclosure bodies mounted and records toggles without rerendering", async () => {
    const view = await mount();
    const group = required(view.renderRoot, ".event-group");
    if (!(group instanceof HTMLDetailsElement)) throw new Error("Expected native details");
    const body = required(group, ".group-body");
    const image = required(group, "pi-web-transcript-image");
    expect(group.open).toBe(false);
    expect(body.textContent).toContain("thinking");
    const render = vi.spyOn(view, "render");
    group.open = true; group.dispatchEvent(new Event("toggle"));
    group.open = false; group.dispatchEvent(new Event("toggle"));
    await view.updateComplete;
    expect(required(group, ".group-body")).toBe(body);
    expect(required(group, "pi-web-transcript-image")).toBe(image);
    expect(render).not.toHaveBeenCalled();
    expect(localStorage.getItem(groupStorageKey(view.sessionId))).not.toBeNull();
  });

  it("can disable every scroll/disclosure effect while keeping manual navigation", async () => {
    const view = await mount(MANUAL_CHAT_BEHAVIORS);
    const { chat, write, move } = scrollingViewport(view);
    expect(frames.size).toBe(0);
    move(2300);
    required(view.renderRoot, ".event-group").dispatchEvent(new Event("toggle"));
    await vi.advanceTimersByTimeAsync(500);
    expect(frames.size).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    required(view.renderRoot, '[aria-label="Jump to top"]').click(); flushFrames();
    expect(chat.scrollTop).toBe(0);
    required(view.renderRoot, '[aria-label="Jump to end"]').click(); flushFrames();
    expect(chat.scrollTop).toBe(5700);
  });

  it("does not rerender or enqueue animation frames for steady-state scrolling", async () => {
    const view = await mount();
    const { move } = scrollingViewport(view);
    flushFrames();
    move(2400); await view.updateComplete;
    frames.clear();
    const render = vi.spyOn(view, "render");
    for (const top of [2350, 2300, 2250]) move(top);
    await view.updateComplete;
    expect(render).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("shows live-follow mode and resumes it through the end arrow or returning to the bottom", async () => {
    const view = await mount();
    const { chat, move } = scrollingViewport(view, 5700);
    flushFrames(); await view.updateComplete;
    const end = required(view.renderRoot, '[aria-label="Jump to end"]');
    expect(end.getAttribute("aria-describedby")).toBe("chat-follow-state");
    const state = required(view.renderRoot, "#chat-follow-state");
    expect(end.classList.contains("following")).toBe(true);
    expect(state.textContent).toBe("Following live");

    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: -10 }));
    await view.updateComplete;
    expect(end.classList.contains("following")).toBe(false);
    expect(state.textContent).toBe("Live following paused");
    expect(end.title).toBe("Jump to end and follow live");
    move(5650); move(5670); await view.updateComplete;
    expect(end.classList.contains("following")).toBe(false);
    move(5700); await view.updateComplete;
    expect(end.classList.contains("following")).toBe(true);

    required(view.renderRoot, '[aria-label="Jump to top"]').click();
    await view.updateComplete;
    expect(chat.scrollTop).toBe(0);
    expect(end.classList.contains("following")).toBe(false);
    end.click(); await view.updateComplete;
    expect(chat.scrollTop).toBe(5700);
    expect(end.classList.contains("following")).toBe(true);
    end.click(); await view.updateComplete;
    expect(end.classList.contains("following")).toBe(true);

    view.behaviors = { ...view.behaviors, followTail: false };
    await view.updateComplete;
    end.click(); await view.updateComplete;
    expect(end.classList.contains("following")).toBe(false);
    expect(end.title).toBe("Jump to end");
    expect(state.textContent).toBe("Automatic following disabled");
  });

  it("pauses on an upward touch reversal even before the finger crosses its starting point", async () => {
    const view = await mount();
    const { chat } = scrollingViewport(view, 5700);
    flushFrames(); await view.updateComplete;
    const end = required(view.renderRoot, '[aria-label="Jump to end"]');
    const touch = (type: string, y: number) => {
      chat.dispatchEvent(new TouchEvent(type, { touches: [new Touch({ identifier: 1, target: chat, clientY: y })] }));
    };
    touch("touchstart", 100);
    touch("touchmove", 80);
    await view.updateComplete;
    expect(end.classList.contains("following")).toBe(true);
    touch("touchmove", 90);
    await view.updateComplete;
    expect(end.classList.contains("following")).toBe(false);
    chat.dispatchEvent(new TouchEvent("touchcancel"));
    end.click(); await view.updateComplete;
    touch("touchmove", 110);
    await view.updateComplete;
    expect(end.classList.contains("following")).toBe(true);
  });

  it("propagates the image switch into persistent normal-chat disclosure bodies", async () => {
    const view = await mount({ ...DEFAULT_CHAT_BEHAVIORS, loadImages: false });
    const image = view.renderRoot.querySelector<TranscriptImage>("pi-web-transcript-image");
    if (image === null) throw new Error("Expected transcript image");
    const presentation = await settleImage(image);
    const native = nativeImage(presentation);
    expect(native.hasAttribute("src")).toBe(false);
    view.behaviors = DEFAULT_CHAT_BEHAVIORS; await view.updateComplete; await settleImage(image);
    expect(nativeImage(presentation)).toBe(native);
    expect(native.src).toBe("data:image/png;base64,QUJD");
  });

  it("applies CSS simplification independently of scrolling capabilities", async () => {
    const view = await mount({ ...DEFAULT_CHAT_BEHAVIORS, visualEffects: false });
    expect(required(view.renderRoot, ".chat-wrap").classList.contains("plain")).toBe(true);
    expect(view.behaviors.followTail).toBe(true);
    view.behaviors = DEFAULT_CHAT_BEHAVIORS; await view.updateComplete;
    expect(required(view.renderRoot, ".chat-wrap").classList.contains("plain")).toBe(false);
  });
});
