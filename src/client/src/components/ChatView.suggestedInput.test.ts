// @vitest-environment happy-dom

import { html, render, type TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionStatus } from "../api";
import { initialAppState, type AppState } from "../appState";
import { machineSessionKey } from "../machineKeys";
import { loadDraft, saveDraft } from "../promptDraftStorage";
import { SessionController } from "../controllers/sessionController";
import { ChatView } from "./ChatView";
import { PiWebApp } from "./PiWebApp";

const session: SessionInfo = {
  id: "session-1", cwd: "/repo", path: "/repo/session.jsonl", created: "now", modified: "now", messageCount: 0, firstMessage: "",
};

function status(suggestedInput?: string): SessionStatus {
  return {
    sessionId: session.id, isStreaming: false, isCompacting: false, isBashRunning: false,
    pendingMessageCount: 0, queuedMessages: [], cost: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...(suggestedInput === undefined ? {} : { suggestedInput }),
  };
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("ChatView suggested input", () => {
  it("shows the latest status suggestion and invokes use only on a real click", async () => {
    const view = new ChatView();
    view.sessionId = session.id;
    view.machineId = "remote";
    view.status = status("first suggestion");
    view.onUseSuggestedInput = vi.fn();
    document.body.append(view);
    await view.updateComplete;
    expect(view.onUseSuggestedInput).not.toHaveBeenCalled();
    view.status = status("latest\n<plain text>");
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".suggested-input-text")?.textContent).toBe("latest\n<plain text>");
    expect(view.shadowRoot?.querySelector(".suggested-input")?.textContent).toContain("Replaces your current draft. Nothing is sent.");
    expect(view.onUseSuggestedInput).not.toHaveBeenCalled();
    useButton(view).click();
    expect(view.onUseSuggestedInput).toHaveBeenCalledExactlyOnceWith("remote", session.id);
  });

  it("has no affordance for absent, unrelated, or non-applicable status, but supports explicit empty input", async () => {
    const view = new ChatView();
    view.sessionId = session.id;
    view.onUseSuggestedInput = vi.fn();
    document.body.append(view);
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".suggested-input")).toBeNull();
    for (const value of [status(), { ...status("wrong session"), sessionId: "other" }]) {
      view.status = value;
      await view.updateComplete;
      expect(view.shadowRoot?.querySelector(".suggested-input")).toBeNull();
    }
    view.status = status("");
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".suggested-input-text")?.textContent).toBe("Empty input");
    useButton(view).click();
    expect(view.onUseSuggestedInput).toHaveBeenCalledOnce();
    view.onUseSuggestedInput = undefined;
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".suggested-input")).toBeNull();
  });

  it("hides pending or already applied input, but keeps a different suggestion available", async () => {
    const view = new ChatView();
    view.sessionId = session.id;
    view.status = status("restored prompt");
    view.onUseSuggestedInput = vi.fn();
    view.suggestedInputPending = true;
    document.body.append(view);
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".suggested-input")).toBeNull();
    view.suggestedInputPending = false;
    view.suppressedSuggestedInput = "restored prompt";
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".suggested-input")).toBeNull();
    view.status = status("different suggestion");
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".suggested-input-text")?.textContent).toBe("different suggestion");
    expect(view.onUseSuggestedInput).not.toHaveBeenCalled();
  });

  it("dismisses the card through a real click without changing the draft, and shows a later suggestion", async () => {
    const key = machineSessionKey("local", session.id);
    saveDraft(key, "unsent draft");
    let state: AppState = { ...initialAppState(), selectedSession: session, status: status("suggestion") };
    const view = new ChatView();
    const replacePromptEditorText = vi.fn();
    const controller = new SessionController(() => state, (patch) => {
      state = { ...state, ...patch };
      view.status = state.status ?? status();
      view.suppressedSuggestedInput = state.suppressedSuggestedInputs[key];
    }, () => undefined, undefined, { replacePromptEditorText });
    view.sessionId = session.id;
    view.status = state.status ?? status();
    view.onUseSuggestedInput = vi.fn();
    view.onDismissSuggestedInput = (machineId, sessionId, text) => { controller.dismissSuggestedInput(machineId, sessionId, text); };
    document.body.append(view);
    await view.updateComplete;
    dismissButton(view).click();
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".suggested-input")).toBeNull();
    controller.applySessionStatus(status("suggestion"));
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".suggested-input")).toBeNull();
    controller.applySessionStatus(status("new suggestion"));
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".suggested-input-text")?.textContent).toBe("new suggestion");
    expect(loadDraft(key)).toBe("unsent draft");
    expect(replacePromptEditorText).not.toHaveBeenCalled();
    expect(view.onUseSuggestedInput).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("wires PiWebApp's rendered buttons to the current-session controller and omits them for archived sessions", async () => {
    // Render just the app's chat seam: mounting the entire shell would start
    // unrelated network/controller lifecycles. Interaction still uses real DOM.
    const app = new PiWebApp();
    const controller: unknown = Reflect.get(app, "sessions");
    if (!(controller instanceof SessionController)) throw new Error("Expected app session controller");
    const use = vi.spyOn(controller, "useSuggestedInput").mockResolvedValue(undefined);
    const dismiss = vi.spyOn(controller, "dismissSuggestedInput").mockImplementation(() => undefined);
    const renderChat: unknown = Reflect.get(app, "renderChatView");
    if (!isRenderChat(renderChat)) throw new Error("Expected chat render seam");
    let state: AppState = { ...initialAppState(), selectedSession: session, status: status("suggestion") };
    const container = document.createElement("div");
    document.body.append(container);
    render(renderChat.call(app, state, session), container);
    const view = container.querySelector<ChatView>("chat-view");
    if (view === null) throw new Error("Expected rendered chat view");
    await view.updateComplete;
    expect(use).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
    useButton(view).click();
    expect(use).toHaveBeenCalledExactlyOnceWith("local", session.id);
    dismissButton(view).click();
    expect(dismiss).toHaveBeenCalledExactlyOnceWith("local", session.id, "suggestion");
    state = { ...state, pendingTreeActions: [{ machineId: "remote", sessionId: session.id }] };
    render(renderChat.call(app, state, session), container);
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".suggested-input")).not.toBeNull();
    state = { ...state, pendingTreeActions: [{ machineId: "local", sessionId: session.id }] };
    render(renderChat.call(app, state, session), container);
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".suggested-input")).toBeNull();
    state = { ...state, pendingTreeActions: [], suppressedSuggestedInputs: {
      [machineSessionKey("local", session.id)]: "suggestion",
    } };
    render(renderChat.call(app, state, session), container);
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".suggested-input")).toBeNull();
    const archived = { ...session, archived: true };
    state = { ...state, selectedSession: archived };
    render(renderChat.call(app, state, archived), container);
    await view.updateComplete;
    expect(view.shadowRoot?.querySelector(".suggested-input")).toBeNull();
    render(html``, container);
    controller.dispose();
  });
});

function useButton(view: ChatView): HTMLButtonElement {
  const button = view.shadowRoot?.querySelector<HTMLButtonElement>(".suggested-input-use");
  if (button === undefined || button === null) throw new Error("Expected Use suggested input button");
  expect(button.textContent).toBe("Use suggested input");
  return button;
}

function dismissButton(view: ChatView): HTMLButtonElement {
  const button = view.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="Dismiss suggested input"]');
  if (button === undefined || button === null) throw new Error("Expected Dismiss suggested input button");
  return button;
}

type RenderChat = (this: PiWebApp, state: AppState, session: SessionInfo) => TemplateResult;
function isRenderChat(value: unknown): value is RenderChat {
  return typeof value === "function";
}
