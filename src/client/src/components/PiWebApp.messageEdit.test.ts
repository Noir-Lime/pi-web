// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import { sessionsApi } from "../api";
import { initialAppState, type AppState } from "../appState";
import { SessionController } from "../controllers/sessionController";
import type { ChatLine } from "./shared";
import { PiWebApp } from "./PiWebApp";

beforeEach(() => {
  vi.spyOn(SessionController.prototype, "getSessionDefaults").mockResolvedValue({ defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5", defaultThinkingLevel: "high" });
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

const userMessage: ChatLine = { role: "user", entryId: "entry-1", parts: [{ type: "text", text: "Original" }] };

function sessionInfo(id: string): SessionInfo {
  return { id, cwd: "/repo", path: `/repo/${id}.jsonl`, created: "2026-07-20T00:00:00.000Z", modified: "2026-07-20T00:00:00.000Z", messageCount: 1, firstMessage: id };
}

function setAppState(app: PiWebApp, patch: Partial<AppState>): void {
  if (!Reflect.set(app, "state", { ...initialAppState(), ...patch })) throw new Error("Could not set PiWebApp state");
}

function appMethod(app: PiWebApp, name: string): (...args: unknown[]) => Promise<unknown> {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`${name} unavailable`);
  return (...args) => Promise.resolve(Reflect.apply(method, app, args));
}

function openedTarget(app: PiWebApp): unknown {
  return Reflect.get(app, "messageEditTarget");
}

const target = { machineId: "local", session: { id: "session-1", cwd: "/repo" }, entryId: "entry-1", expectedText: "Original" };

function appWith(patch: Partial<AppState> = {}): PiWebApp {
  const app = new PiWebApp();
  const selected = sessionInfo("session-1");
  setAppState(app, { selectedSession: selected, sessions: [selected], messages: [userMessage], ...patch });
  Reflect.set(app, "messageEditTarget", target);
  return app;
}

describe("PiWebApp message edit", () => {
  it("sends the snapshotted identity and expected text, keeps the exact new text, then closes", async () => {
    const editMessage = vi.spyOn(sessionsApi, "editMessage").mockResolvedValue(undefined);
    const app = appWith();
    await appMethod(app, "saveMessageEdit")(target, "  New\ntext ");
    expect(editMessage).toHaveBeenCalledExactlyOnceWith({ id: "session-1", cwd: "/repo" }, { targetId: "entry-1", text: "  New\ntext ", expectedText: "Original" }, "local");
    expect(openedTarget(app)).toBeUndefined();
  });

  it("does not refresh history itself; the server tree event owns that", async () => {
    vi.spyOn(sessionsApi, "editMessage").mockResolvedValue(undefined);
    const refresh = vi.spyOn(SessionController.prototype, "refreshSelectedSession");
    await appMethod(appWith(), "saveMessageEdit")(target, "New");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the edit open and reports the server error when the request fails", async () => {
    vi.spyOn(sessionsApi, "editMessage").mockRejectedValue(new Error("Message changed"));
    const app = appWith();
    await expect(appMethod(app, "saveMessageEdit")(target, "New")).rejects.toThrow("Message changed");
    expect(openedTarget(app)).toBe(target);
  });

  it.each([
    ["a different session is selected", { selectedSession: sessionInfo("other") }],
    ["the same session id is selected from another cwd", { selectedSession: { ...sessionInfo("session-1"), cwd: "/other" } }],
    ["the session is archived", { selectedSession: { ...sessionInfo("session-1"), archived: true } }],
    ["a prompt is sending", { sendingPrompts: { "session-1": true as const } }],
    ["the message text changed", { messages: [{ ...userMessage, parts: [{ type: "text" as const, text: "Changed elsewhere" }] }] }],
    ["the message is gone", { messages: [] }],
  ])("refuses to write when %s", async (_name, patch) => {
    const editMessage = vi.spyOn(sessionsApi, "editMessage").mockResolvedValue(undefined);
    await expect(appMethod(appWith(patch), "saveMessageEdit")(target, "New")).rejects.toThrow();
    expect(editMessage).not.toHaveBeenCalled();
  });
});
