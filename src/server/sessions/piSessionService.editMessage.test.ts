import { describe, expect, it, vi } from "vitest";
import { PiSessionService, type PiSessionManager, type PiSessionServiceDependencies } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, fakeSessionManager, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const id = "edit-session";
const original = "  Original user text\nkeep spaces  ";
const request = { targetId: "user-1", expectedText: original, text: "  Corrected text\nno resend  " };

function harness(managerPatch: Partial<PiSessionManager> = {}, dependencies: Partial<PiSessionServiceDependencies> = {}) {
  const target = { type: "message", id: "user-1", parentId: null, message: { role: "user", content: original, timestamp: 1 } };
  const later = { type: "message", id: "assistant-1", parentId: "user-1", message: { role: "assistant", content: [{ type: "text", text: "Existing reply" }], timestamp: 2 } };
  const edit = vi.fn((_targetId: string, _expected: string, text: string) => { target.message.content = text; });
  const refresh = vi.fn();
  const navigate = vi.fn(() => Promise.resolve({ cancelled: false }));
  const manager = fakeSessionManager("/workspace", {
    getSessionId: () => id, getSessionFile: () => "/sessions/edit-session.jsonl", getBranch: () => [target, later],
    editUserMessageText: edit, ...managerPatch,
  });
  const fake = fakeRuntime(id, { sessionManager: manager, sessionFile: "/sessions/edit-session.jsonl", refreshContext: refresh, navigateTree: navigate });
  const hub = new CapturingSessionEventHub();
  const invalidate = vi.fn();
  const service = new PiSessionService(hub, {
    agentDir: "/tmp/pi-web-test-agent", modelRuntime: testModelRuntime,
    archiveStore: emptyArchiveStore(), createAgentRuntime: runtimeCreator(fake.runtime),
    sessionManager: { ...sessionGateway([sessionRecord(id)]), invalidateSessionFile: invalidate },
    heartbeatIntervalMs: 60_000, ...dependencies,
  });
  return { service, fake, hub, target, later, edit, refresh, navigate, invalidate };
}

describe("PiSessionService in-place user text editing", () => {
  it("delegates the exact edit, refreshes context and transcript caches without prompt, navigation or later-entry mutation", async () => {
    const h = harness();
    try {
      await h.service.start("/workspace");
      const later = structuredClone(h.later);
      const leaf = h.fake.session.sessionManager.getLeafId();
      await h.service.editMessage(sessionRef(id), request);
      expect(h.edit).toHaveBeenCalledExactlyOnceWith(request.targetId, original, request.text);
      expect(h.target.message.content).toBe(request.text);
      expect(h.later).toEqual(later);
      expect(h.fake.session.sessionManager.getLeafId()).toBe(leaf);
      expect(h.refresh).toHaveBeenCalledOnce();
      expect(h.invalidate).toHaveBeenCalledWith("/sessions/edit-session.jsonl");
      expect(h.hub.sessionEvents).toContainEqual({ sessionId: id, event: { type: "session.tree.changed" } });
      expect(h.navigate).not.toHaveBeenCalled();
      expect(h.fake.calls.prompt).toHaveLength(0);
      expect(h.fake.calls.sendCustomMessage).toHaveLength(0);
    } finally { await h.service.dispose(); }
  });

  it("rejects stale text, non-user and off-branch targets, empty text and ambiguous text blocks before owner mutation", async () => {
    const h = harness();
    try {
      await h.service.start("/workspace");
      for (const invalid of [
        { ...request, expectedText: original.trim() }, { ...request, targetId: "assistant-1" },
        { ...request, targetId: "other-branch" }, { ...request, targetId: " " }, { ...request, text: " \n " },
      ]) await expect(h.service.editMessage(sessionRef(id), invalid)).rejects.toThrow();
      const empty = harness({ getBranch: () => [{ type: "message", id: "user-1", message: { role: "user", content: "" } }] });
      try {
        await empty.service.start("/workspace");
        await empty.service.editMessage(sessionRef(id), { ...request, expectedText: "" });
        expect(empty.edit).toHaveBeenCalledWith("user-1", "", request.text);
      } finally { await empty.service.dispose(); }
      const ambiguous = harness({ getBranch: () => [{ type: "message", id: "user-1", message: { role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] });
      try {
        await ambiguous.service.start("/workspace");
        await expect(ambiguous.service.editMessage(sessionRef(id), request)).rejects.toThrow("exactly one");
        expect(ambiguous.edit).not.toHaveBeenCalled();
      } finally { await ambiguous.service.dispose(); }
      expect(h.edit).not.toHaveBeenCalled();
      expect(h.refresh).not.toHaveBeenCalled();
    } finally { await h.service.dispose(); }
  });

  it("rejects streaming, compacting, bash and queued work rather than aborting or waiting", async () => {
    const h = harness();
    try {
      await h.service.start("/workspace");
      for (const field of ["isStreaming", "isCompacting", "isBashRunning"] as const) {
        h.fake.session[field] = true;
        await expect(h.service.editMessage(sessionRef(id), request)).rejects.toThrow("Stop current session activity");
        h.fake.session[field] = false;
      }
      h.fake.session.pendingMessageCount = 1;
      await expect(h.service.editMessage(sessionRef(id), request)).rejects.toThrow("Stop current session activity");
      h.fake.session.pendingMessageCount = 0;
      expect(h.edit).not.toHaveBeenCalled();
      expect(h.fake.calls.abort).toBe(0);
      await h.service.editMessage(sessionRef(id), request);
      expect(h.edit).toHaveBeenCalledOnce();
    } finally { await h.service.dispose(); }
  });

  it("rejects edits while session-tree navigation holds the existing exclusion gate", async () => {
    const h = harness();
    let finish!: (result: { cancelled: boolean }) => void;
    const navigation = vi.fn(() => new Promise<{ cancelled: boolean }>((resolve) => { finish = resolve; }));
    h.fake.session.navigateTree = navigation;
    try {
      await h.service.start("/workspace");
      const moving = h.service.navigateTree(sessionRef(id), { targetId: "user-1", expectedLeafId: "leaf-1", summary: { mode: "none" } });
      await vi.waitFor(() => { expect(navigation).toHaveBeenCalledOnce(); });
      await expect(h.service.editMessage(sessionRef(id), request)).rejects.toThrow("Stop current session activity");
      expect(h.edit).not.toHaveBeenCalled();
      finish({ cancelled: true });
      await moving;
      await h.service.editMessage(sessionRef(id), request);
      expect(h.edit).toHaveBeenCalledOnce();
    } finally { await h.service.dispose(); }
  });

  it("rejects archived sessions and unsupported old runtimes without writes", async () => {
    const h = harness({}, { archiveStore: { ...emptyArchiveStore(), get: () => Promise.resolve({ sessionId: id, cwd: "/workspace", archivedAt: "2026-01-01T00:00:00.000Z", archivePath: `/archive/${id}.jsonl` }) } });
    try {
      await expect(h.service.editMessage(sessionRef(id), request)).rejects.toThrow("Archived sessions are read-only");
      expect(h.edit).not.toHaveBeenCalled();
    } finally { await h.service.dispose(); }
    const old = harness();
    delete old.fake.session.sessionManager.editUserMessageText;
    try {
      await old.service.start("/workspace");
      await expect(old.service.editMessage(sessionRef(id), request)).rejects.toThrow("not supported");
      expect(old.refresh).not.toHaveBeenCalled();
    } finally { await old.service.dispose(); }
  });

  it("owner failure does not refresh or publish a successful transcript reset; gate releases for retry", async () => {
    const edit = vi.fn().mockImplementationOnce(() => { throw new Error("atomic rename failed"); });
    const h = harness({ editUserMessageText: edit });
    try {
      await h.service.start("/workspace");
      h.hub.sessionEvents.length = 0;
      await expect(h.service.editMessage(sessionRef(id), request)).rejects.toThrow("atomic rename failed");
      expect(h.refresh).not.toHaveBeenCalled();
      expect(h.invalidate).not.toHaveBeenCalled();
      expect(h.hub.sessionEvents.some(({ event }) => event.type === "session.tree.changed")).toBe(false);
      await h.service.editMessage(sessionRef(id), request);
      expect(h.refresh).toHaveBeenCalledOnce();
    } finally { await h.service.dispose(); }
  });
});
