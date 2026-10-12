import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { machineSessionKey } from "../machineKeys";
import { loadDraft, saveDraft } from "../promptDraftStorage";
import { SessionController } from "./sessionController";
import { FakeSocket, MemoryStorage, oldSession, replacementSession, status, type AppState } from "./sessionController.testSupport";

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

describe("SessionController explicit suggested input use", () => {
  it.each(["use this\nverbatim  ", ""])("saves and replaces the current editor only when requested (%s)", async (suggestedInput) => {
    const key = machineSessionKey("local", oldSession.id);
    saveDraft(key, "unsent draft");
    let state: AppState = { ...initialAppState(), selectedSession: oldSession, status: { ...status(oldSession.id), suggestedInput } };
    const replacePromptEditorText = vi.fn();
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined,
      { socket: new FakeSocket(), replacePromptEditorText });
    expect(loadDraft(key)).toBe("unsent draft");
    expect(replacePromptEditorText).not.toHaveBeenCalled();
    await controller.useSuggestedInput("local", oldSession.id);
    expect(loadDraft(key)).toBe(suggestedInput);
    expect(replacePromptEditorText).toHaveBeenCalledExactlyOnceWith({ machineId: "local", sessionId: oldSession.id, text: suggestedInput });
    // The daemon still owns the latest suggestion; use is neither send nor clear.
    expect(state.status?.suggestedInput).toBe(suggestedInput);
    expect(state.suppressedSuggestedInputs[key]).toBe(suggestedInput);
    expect(state.messages).toEqual([]);
    controller.dispose();
  });

  it("ignores stale targets, unavailable suggestions, mismatched status, and archived sessions", async () => {
    const key = machineSessionKey("local", oldSession.id);
    saveDraft(key, "protected draft");
    let state: AppState = { ...initialAppState(), selectedSession: oldSession, status: { ...status(oldSession.id), suggestedInput: "suggestion" } };
    const replacePromptEditorText = vi.fn();
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined,
      { socket: new FakeSocket(), replacePromptEditorText });
    await controller.useSuggestedInput("remote", oldSession.id);
    await controller.useSuggestedInput("local", replacementSession.id);
    state = { ...state, status: status(oldSession.id) };
    await controller.useSuggestedInput("local", oldSession.id);
    state = { ...state, status: { ...status(replacementSession.id), suggestedInput: "another session" } };
    await controller.useSuggestedInput("local", oldSession.id);
    state = { ...state, selectedSession: { ...oldSession, archived: true }, status: { ...status(oldSession.id), suggestedInput: "archived" } };
    await controller.useSuggestedInput("local", oldSession.id);
    expect(loadDraft(key)).toBe("protected draft");
    expect(replacePromptEditorText).not.toHaveBeenCalled();
    controller.dispose();
  });

  it.each(["dismiss this\nverbatim  ", ""])("dismisses only the visible suggestion without changing the draft or daemon status (%s)", (suggestedInput) => {
    const key = machineSessionKey("local", oldSession.id);
    const suggestion = { ...status(oldSession.id), suggestedInput };
    saveDraft(key, "unsent draft");
    let state: AppState = { ...initialAppState(), selectedSession: oldSession, status: suggestion, sessionStatuses: { [oldSession.id]: suggestion } };
    const replacePromptEditorText = vi.fn();
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined,
      { socket: new FakeSocket(), replacePromptEditorText });

    controller.dismissSuggestedInput("local", oldSession.id, suggestedInput);
    expect(state.suppressedSuggestedInputs[key]).toBe(suggestedInput);
    expect(loadDraft(key)).toBe("unsent draft");
    expect(replacePromptEditorText).not.toHaveBeenCalled();
    expect(state.status).toBe(suggestion);
    expect(state.sessionStatuses[oldSession.id]).toBe(suggestion);
    controller.applySessionStatus({ ...suggestion });
    expect(state.suppressedSuggestedInputs[key]).toBe(suggestedInput);

    controller.applySessionStatus({ ...suggestion, suggestedInput: "new suggestion" });
    expect(state.suppressedSuggestedInputs[key]).toBeUndefined();
    controller.dismissSuggestedInput("local", oldSession.id, "new suggestion");
    controller.applySessionStatus(status(oldSession.id));
    expect(state.suppressedSuggestedInputs[key]).toBeUndefined();
    controller.applySessionStatus(suggestion);
    expect(state.suppressedSuggestedInputs[key]).toBeUndefined();
    expect(loadDraft(key)).toBe("unsent draft");
    expect(replacePromptEditorText).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("ignores dismissal for stale text, other machines/sessions, unavailable status, and archived sessions", () => {
    const key = machineSessionKey("local", oldSession.id);
    saveDraft(key, "protected draft");
    let state: AppState = { ...initialAppState(), selectedSession: oldSession, status: { ...status(oldSession.id), suggestedInput: "current suggestion" } };
    const replacePromptEditorText = vi.fn();
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined,
      { socket: new FakeSocket(), replacePromptEditorText });
    controller.dismissSuggestedInput("local", oldSession.id, "outdated suggestion");
    controller.dismissSuggestedInput("remote", oldSession.id, "current suggestion");
    controller.dismissSuggestedInput("local", replacementSession.id, "current suggestion");
    state = { ...state, status: status(oldSession.id) };
    controller.dismissSuggestedInput("local", oldSession.id, "current suggestion");
    state = { ...state, status: { ...status(replacementSession.id), suggestedInput: "wrong session" } };
    controller.dismissSuggestedInput("local", oldSession.id, "wrong session");
    state = { ...state, selectedSession: { ...oldSession, archived: true }, status: { ...status(oldSession.id), suggestedInput: "archived" } };
    controller.dismissSuggestedInput("local", oldSession.id, "archived");
    expect(state.suppressedSuggestedInputs).toEqual({});
    expect(loadDraft(key)).toBe("protected draft");
    expect(replacePromptEditorText).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("reports editor replacement failure while retaining the deliberately saved draft", async () => {
    let state: AppState = { ...initialAppState(), selectedSession: oldSession, status: { ...status(oldSession.id), suggestedInput: "requested" } };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined,
      { socket: new FakeSocket(), replacePromptEditorText: () => Promise.reject(new Error("Editor unavailable")) });
    await controller.useSuggestedInput("local", oldSession.id);
    expect(loadDraft(machineSessionKey("local", oldSession.id))).toBe("requested");
    expect(state.suppressedSuggestedInputs).toEqual({});
    expect(Object.values(state.browserErrors).map((error) => error.message).join("\n")).toContain("Editor unavailable");
    controller.dispose();
  });
});
