import { describe, expect, it, vi } from "vitest";
import type { Project, WorkspaceProviderAuthorityResolution } from "../../shared/apiTypes.js";
import { SessionUnreadStore, type SessionUnreadMutation } from "../sessions/sessionUnreadStore.js";
import { ProjectLifecycleService } from "./projectLifecycleService.js";
import { MachineStatusService } from "../status/machineStatusService.js";
import { CachedWorkspaceAttribution } from "../status/workspaceAttribution.js";

const root = project("root", "/");
const removed = project("removed", "/srv/removed");
const kept = project("kept", "/srv/kept");

describe("ProjectLifecycleService", () => {
  it("prunes legacy orphan completions rather than attributing them to an ancestor", async () => {
    const fixture = lifecycle([root, kept]);
    complete(fixture.unread, removed.path);
    complete(fixture.unread, kept.path);
    const logger = { warn: vi.fn() };
    const status = new MachineStatusService({
      activity: { snapshot: () => ({ workspaces: [] }) },
      unread: fixture.unread,
      attribution: new CachedWorkspaceAttribution({
        projects: fixture.projects,
        workspaces: { list: async (owner) => [...(await fixture.workspaces.resolve(owner)).workspaces] },
        logger,
      }),
      publisher: { publish: vi.fn() },
      logger,
    });
    await fixture.service.refresh();
    await status.refresh();
    expect(status.snapshot().projects).toEqual({ kept: { "core:unread": true } });
    expect(status.snapshot().unattributed).toEqual({});
    expect(fixture.unread.catalogSnapshot().sessions.map((entry) => entry.cwd)).toEqual([kept.path]);
    expect(fixture.mutations).toHaveLength(1);
    expect(fixture.mutations[0]?.event).toMatchObject({ cwd: removed.path, unread: null });
  });

  it("clears removed-project unread and active latches, and re-adds without old state", async () => {
    const fixture = lifecycle([root, removed]);
    await fixture.service.refresh();
    complete(fixture.unread, removed.path);
    fixture.unread.observeActivityState("busy", removed.path, true);

    await fixture.service.close(removed.id);
    expect(fixture.unread.catalogSnapshot().sessions).toEqual([]);
    expect(await fixture.projects.list()).toEqual([root]);
    complete(fixture.unread, removed.path); // Late runtime events while removed.
    expect(fixture.unread.catalogSnapshot().sessions).toEqual([]);

    await fixture.service.add({ path: removed.path });
    fixture.unread.observeActivityState("busy", removed.path, false);
    expect(fixture.unread.catalogSnapshot().sessions).toEqual([]);
    complete(fixture.unread, removed.path); // Genuinely new work is tracked.
    expect(fixture.unread.catalogSnapshot().sessions).toHaveLength(1);
  });

  it("prunes old state before admitting the cwd of an already removed project", async () => {
    const fixture = lifecycle([root]);
    complete(fixture.unread, removed.path);
    await fixture.service.add({ path: removed.path });
    expect(fixture.unread.catalogSnapshot().sessions).toEqual([]);
  });

  it("preserves exact external worktrees and workspace paths shared by another project", async () => {
    const fixture = lifecycle([removed, kept], new Map([
      [removed.id, [removed.path, "/external/shared"]],
      [kept.id, [kept.path, "/external/shared"]],
    ]));
    complete(fixture.unread, "/external/shared");
    complete(fixture.unread, removed.path);
    await fixture.service.close(removed.id);
    expect(fixture.unread.catalogSnapshot().sessions.map((entry) => entry.cwd)).toEqual(["/external/shared"]);
  });

  it.each(["degraded", "probe-failed", "throw"])("does not prune on incomplete provider resolution (%s)", async (failure) => {
    const fixture = lifecycle([kept]);
    complete(fixture.unread, "/external/worktree");
    fixture.workspaces.resolve.mockImplementation(() => {
      if (failure === "throw") return Promise.reject(new Error("provider offline"));
      return Promise.resolve({
        ...resolution(kept, [kept.path]),
        status: failure === "degraded" ? "degraded" : "folder",
        diagnostics: failure === "probe-failed" ? [{ code: "probe-failed", message: "provider offline", tier: "primary" }] : [],
      });
    });
    await expect(fixture.service.refresh()).rejects.toThrow();
    expect(fixture.unread.catalogSnapshot().sessions).toHaveLength(1);
    expect(fixture.reconcile).not.toHaveBeenCalled();
    await expect(fixture.service.add({ path: removed.path })).rejects.toThrow();
    expect(fixture.projects.add).not.toHaveBeenCalled();
  });

  it("admits a new root directly and discovers its extra workspaces through normal refresh", async () => {
    const paths = new Map<string, string[]>();
    const fixture = lifecycle([kept], paths);
    const added = await fixture.service.add({ path: removed.path });
    expect(fixture.workspaces.resolve.mock.calls.map(([owner]) => owner.id)).toEqual([kept.id]);
    complete(fixture.unread, added.path);
    expect(fixture.unread.catalogSnapshot().sessions.map((entry) => entry.cwd)).toEqual([added.path]);

    paths.set(added.id, [added.path, "/external/new"]);
    await fixture.service.refresh();
    complete(fixture.unread, "/external/new");
    expect(fixture.unread.catalogSnapshot().sessions.map((entry) => entry.cwd)).toEqual(["/external/new", added.path]);
  });

  it("restores tracking eligibility when the registration removal write fails", async () => {
    const fixture = lifecycle([removed]);
    await fixture.service.refresh();
    complete(fixture.unread, removed.path);
    fixture.projects.close.mockRejectedValueOnce(new Error("projects.json write failed"));
    await expect(fixture.service.close(removed.id)).rejects.toThrow("projects.json write failed");
    expect(await fixture.projects.list()).toEqual([removed]);
    expect(fixture.unread.catalogSnapshot().sessions).toEqual([]);
    complete(fixture.unread, removed.path);
    expect(fixture.unread.catalogSnapshot().sessions).toHaveLength(1);
  });

  it("does not treat an unreadable project catalog as an empty list", async () => {
    const fixture = lifecycle([kept]);
    complete(fixture.unread, kept.path);
    fixture.projects.list.mockRejectedValue(new Error("projects.json unreadable"));
    await expect(fixture.service.refresh()).rejects.toThrow("projects.json unreadable");
    expect(fixture.reconcile).not.toHaveBeenCalled();
    expect(fixture.unread.catalogSnapshot().sessions).toHaveLength(1);
  });

  it("can remove an unavailable project without resolving the removed provider", async () => {
    const fixture = lifecycle([removed]);
    fixture.workspaces.resolve.mockRejectedValue(new Error("removed directory unavailable"));
    complete(fixture.unread, removed.path);
    await fixture.service.close(removed.id);
    expect(fixture.unread.catalogSnapshot().sessions).toEqual([]);
    expect(fixture.workspaces.resolve).not.toHaveBeenCalled();
  });

  it("does not remove the project registration if durable cleanup fails, and permits retry", async () => {
    const fixture = lifecycle([removed]);
    fixture.reconcile.mockRejectedValueOnce(new Error("disk full"));
    await expect(fixture.service.close(removed.id)).rejects.toThrow("disk full");
    expect(fixture.projects.close).not.toHaveBeenCalled();
    await fixture.service.close(removed.id);
    expect(await fixture.projects.list()).toEqual([]);
  });

  it("serializes re-add behind durable close cleanup and drains admitted work on shutdown", async () => {
    const fixture = lifecycle([removed]);
    let finishCleanup = (): void => { throw new Error("cleanup has not started"); };
    let notifyStarted = (): void => { throw new Error("start signal not initialized"); };
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    fixture.reconcile.mockImplementationOnce(() => new Promise<() => void>((resolve) => {
      finishCleanup = () => { resolve(() => undefined); };
      notifyStarted();
    }));
    const closing = fixture.service.close(removed.id);
    await started;
    const adding = fixture.service.add({ path: removed.path });
    let drained = false;
    const shutdown = fixture.service.closeAll().then(() => { drained = true; });
    await expect(fixture.service.add({ path: kept.path })).rejects.toThrow("shutting down");
    expect(drained).toBe(false);
    expect(fixture.projects.close).not.toHaveBeenCalled();
    expect(fixture.projects.add).not.toHaveBeenCalled();
    finishCleanup();
    await Promise.all([closing, adding, shutdown]);
    expect(drained).toBe(true);
    await expect(fixture.service.refresh()).rejects.toThrow("shutting down");
    expect(fixture.projects.close).toHaveBeenCalledOnce();
    expect(fixture.projects.add).toHaveBeenCalledOnce();
    expect((await fixture.projects.list()).map((entry) => entry.path)).toEqual([removed.path]);
  });

  it("refreshes eligibility for externally created workspaces", async () => {
    const paths = new Map([[kept.id, [kept.path]]]);
    const fixture = lifecycle([kept], paths);
    await fixture.service.refresh();
    paths.set(kept.id, [kept.path, "/external/new"]);
    await fixture.service.refresh();
    complete(fixture.unread, "/external/new");
    expect(fixture.unread.catalogSnapshot().sessions.map((entry) => entry.cwd)).toEqual(["/external/new"]);
  });
});

function lifecycle(initial: Project[], paths = new Map<string, string[]>()) {
  let registered = [...initial];
  const projects = {
    list: vi.fn(() => Promise.resolve([...registered])),
    add: vi.fn((input: { path: string }) => {
      const added = project(`new-${String(registered.length)}`, input.path);
      registered.push(added);
      return Promise.resolve(added);
    }),
    close: vi.fn((id: string) => {
      registered = registered.filter((entry) => entry.id !== id);
      return Promise.resolve();
    }),
  };
  const workspaces = {
    resolve: vi.fn((owner: Project) => Promise.resolve(resolution(owner, paths.get(owner.id) ?? [owner.path]))),
  };
  const unread = new SessionUnreadStore();
  const mutations: SessionUnreadMutation[] = [];
  const reconcile = vi.fn(async (cwds: Iterable<string>) => {
    const restore = unread.captureWorkspaceEligibility();
    mutations.push(...unread.reconcileWorkspaces(cwds));
    await unread.flush();
    return restore;
  });
  const onChanged = vi.fn();
  const service = new ProjectLifecycleService({
    projects, workspaces, reconcileUnreadWorkspaces: reconcile, onChanged,
    allowUnreadWorkspaces: (cwds) => { unread.allowWorkspaces(cwds); },
  });
  return { service, projects, workspaces, unread, mutations, reconcile, onChanged };
}

function resolution(owner: Project, paths: string[]): WorkspaceProviderAuthorityResolution {
  return {
    projectId: owner.id,
    status: "folder",
    diagnostics: [],
    workspaces: paths.map((path) => ({ id: path, projectId: owner.id, path, isMain: path === owner.path, label: path })),
  };
}

function project(id: string, path: string): Project {
  return { id, path, name: id, createdAt: "2026-09-01T00:00:00Z" };
}

function complete(store: SessionUnreadStore, cwd: string): void {
  store.observeActivityState(cwd, cwd, true);
  store.observeActivityState(cwd, cwd, false);
}
