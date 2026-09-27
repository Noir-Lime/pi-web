import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { browserErrorScopeKey, sessionBrowserErrorScope } from "../browserErrors";
import type { CommandResult } from "../api";
import { SessionController } from "./sessionController";
import { InMemorySessionSelectionMemory } from "./sessionSelection";
import { defaultApi, FakeSocket, oldSession, workspace, type AppState, type SessionInfo, type SessionRef } from "./sessionController.testSupport";

const selected: SessionInfo = { ...oldSession, persisted: true };
const target: SessionInfo = { ...oldSession, id: "target-session", path: "/tmp/target-session.jsonl", persisted: true, name: "Old name" };

function setup(runCommand: (session: SessionRef, text: string, machineId?: string) => Promise<CommandResult>, sessions: SessionInfo[] = [selected, target]) {
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: selected, sessions };
  const controller = new SessionController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    () => undefined,
    new InMemorySessionSelectionMemory(),
    { api: { ...defaultApi, runCommand }, socket: new FakeSocket() },
  );
  return { controller, state: () => state };
}

function errorFor(state: AppState, session: SessionInfo): string | undefined {
  const scope = sessionBrowserErrorScope("local", session.id, { cwd: session.cwd, projectId: workspace.projectId, workspaceId: workspace.id });
  return state.browserErrors[browserErrorScopeKey(scope)]?.message;
}

describe("SessionController.renameSession", () => {
  it("renames a non-selected current session through the /name command route without changing selection", async () => {
    const runCommand = vi.fn<(session: SessionRef, text: string, machineId?: string) => Promise<CommandResult>>(() => Promise.resolve({ type: "done", message: "Session named: New name", session: { ...target, name: "New name" } }));
    const { controller, state } = setup(runCommand);

    await expect(controller.renameSession(target, "  New name ")).resolves.toBe(true);

    expect(runCommand).toHaveBeenCalledWith(target, "/name New name", "local");
    expect(state().sessions.find((session) => session.id === target.id)?.name).toBe("New name");
    expect(state().selectedSession).toBe(selected);
    expect(state().messages).toEqual([]);
    expect(errorFor(state(), target)).toBeUndefined();
  });

  it("updates the selected session's visible name", async () => {
    const { controller, state } = setup(() => Promise.resolve({ type: "done", session: { ...selected, name: "Renamed" } }));

    await controller.renameSession(selected, "Renamed");

    expect(state().selectedSession?.name).toBe("Renamed");
    expect(state().sessions[0]?.name).toBe("Renamed");
  });

  it("reports an unsupported command result as a session error and keeps the old name", async () => {
    const { controller, state } = setup(() => Promise.resolve({ type: "unsupported", message: "Session tree navigation is active" }));

    await expect(controller.renameSession(target, "New name")).resolves.toBe(false);

    expect(state().sessions.find((session) => session.id === target.id)?.name).toBe("Old name");
    expect(errorFor(state(), target)).toBe("Rename failed: Session tree navigation is active");
  });

  it("reports request failures as a session error", async () => {
    const { controller, state } = setup(() => Promise.reject(new Error("offline")));

    await expect(controller.renameSession(target, "New name")).resolves.toBe(false);

    expect(state().sessions.find((session) => session.id === target.id)?.name).toBe("Old name");
    expect(errorFor(state(), target)).toBe("Rename failed: offline");
  });

  it("does not call the command route for blank names, archived, or unpersisted sessions", async () => {
    const archived: SessionInfo = { ...target, archived: true, archivedAt: "later" };
    const transient: SessionInfo = { ...target, id: "transient", persisted: false };
    const runCommand = vi.fn(() => Promise.resolve<CommandResult>({ type: "done" }));
    const { controller } = setup(runCommand, [selected, archived, transient]);

    await expect(controller.renameSession(target, "   ")).resolves.toBe(false);
    await expect(controller.renameSession(archived, "Name")).resolves.toBe(false);
    await expect(controller.renameSession(transient, "Name")).resolves.toBe(false);

    expect(runCommand).not.toHaveBeenCalled();
  });
});
