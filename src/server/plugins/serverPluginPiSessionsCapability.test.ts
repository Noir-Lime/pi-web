import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PI_WEB_HOST_PI_SESSIONS_CAPABILITY } from "../../server-plugin-api.js";
import type { WorkspaceListing } from "../../shared/apiTypes.js";
import type { Project } from "../types.js";
import { createServerPluginPiSessionsCapabilityFactory } from "./serverPluginPiSessionsCapability.js";

const project: Project = {
  id: "project-1",
  name: "Project",
  path: resolve("/repo"),
  createdAt: "2026-09-10T00:00:00.000Z",
};

function deferred<T = void>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function workspace(path = resolve("/repo/worktree")): WorkspaceListing {
  return {
    id: "workspace-1",
    projectId: project.id,
    path,
    label: "Worktree",
    isMain: false,
  };
}

function harness(options: {
  maxConcurrentRunsPerPlugin?: number;
  runCompletion?: (cwd: string, prompt: string, signal: AbortSignal) => Promise<void>;
  startOneShotRun?: (
    cwd: string,
    prompt: string,
    signal: AbortSignal,
  ) => Promise<{ id: string; completion: Promise<void> }>;
} = {}) {
  let currentWorkspace = workspace();
  let sessionSequence = 0;
  const projects = {
    requireProject: vi.fn((projectId: string) => projectId === project.id
      ? Promise.resolve({ ...project })
      : Promise.reject(new Error("Project not found"))),
  };
  const workspaces = {
    resolve: vi.fn((selectedProject: Project, signal?: AbortSignal) => {
      void selectedProject;
      void signal;
      return Promise.resolve({
        status: "folder" as const,
        projectId: project.id,
        workspaces: [currentWorkspace],
        diagnostics: [],
      });
    }),
  };
  const runCompletion = vi.fn(options.runCompletion ?? (() => Promise.resolve()));
  const sessions = {
    startOneShotRun: vi.fn(options.startOneShotRun ?? ((cwd: string, prompt: string, signal: AbortSignal) => {
      sessionSequence += 1;
      return Promise.resolve({
        id: `session-${String(sessionSequence)}`,
        completion: runCompletion(cwd, prompt, signal),
      });
    })),
    abort: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
  };
  const lifetime = new AbortController();
  const factory = createServerPluginPiSessionsCapabilityFactory({
    projects,
    workspaces,
    sessions,
    ...(options.maxConcurrentRunsPerPlugin === undefined
      ? {}
      : { maxConcurrentRunsPerPlugin: options.maxConcurrentRunsPerPlugin }),
  });
  const instance = factory.create({
    pluginId: "run-consumer",
    packageRoot: "/plugins/run-consumer",
    lifetimeSignal: lifetime.signal,
  });
  const capability = PI_WEB_HOST_PI_SESSIONS_CAPABILITY.parse(instance.value);
  const input = { projectId: project.id, workspaceId: currentWorkspace.id, prompt: "Do the work" };
  return {
    capability,
    factory,
    input,
    instance,
    lifetime,
    projects,
    runCompletion,
    sessions,
    workspaces,
    setWorkspace(next: WorkspaceListing) { currentWorkspace = next; },
  };
}

describe("server plugin PI sessions capability", () => {
  it("re-resolves live workspace authority for each run and preserves transcripts while releasing admission", async () => {
    const fixture = harness({ maxConcurrentRunsPerPlugin: 1 });

    const first = await fixture.capability.run(fixture.input);
    await expect(first.completion).resolves.toEqual({ status: "completed" });
    fixture.setWorkspace(workspace(resolve("/repo/moved-worktree")));
    const second = await fixture.capability.run(fixture.input);
    await expect(second.completion).resolves.toEqual({ status: "completed" });

    expect(first.sessionId).toBe("session-1");
    expect(second.sessionId).toBe("session-2");
    expect(fixture.projects.requireProject).toHaveBeenCalledTimes(2);
    expect(fixture.workspaces.resolve).toHaveBeenCalledTimes(2);
    expect(fixture.workspaces.resolve.mock.calls.every(([, signal]) => signal === fixture.lifetime.signal)).toBe(true);
    expect(fixture.sessions.startOneShotRun).toHaveBeenNthCalledWith(
      1,
      resolve("/repo/worktree"),
      fixture.input.prompt,
      fixture.lifetime.signal,
    );
    expect(fixture.sessions.startOneShotRun).toHaveBeenNthCalledWith(
      2,
      resolve("/repo/moved-worktree"),
      fixture.input.prompt,
      fixture.lifetime.signal,
    );
    expect(fixture.runCompletion).toHaveBeenCalledTimes(2);
    expect(fixture.sessions.stop).toHaveBeenCalledTimes(2);
    expect(fixture.sessions.abort).not.toHaveBeenCalled();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(await first.completion)).toBe(true);
    expect(Object.isFrozen(fixture.factory)).toBe(true);
    expect(Object.isFrozen(fixture.instance)).toBe(true);
    await fixture.instance.dispose?.(AbortSignal.timeout(1_000));
  });

  it("bounds concurrent admissions and releases the quota after completion and failure", async () => {
    const firstPrompt = deferred();
    let promptCall = 0;
    const fixture = harness({
      maxConcurrentRunsPerPlugin: 1,
      runCompletion: () => {
        promptCall += 1;
        if (promptCall === 1) return firstPrompt.promise;
        if (promptCall === 2) return Promise.reject(new Error("model unavailable"));
        return Promise.resolve();
      },
    });

    const first = await fixture.capability.run(fixture.input);
    await expect(fixture.capability.run(fixture.input))
      .rejects.toThrow("run-consumer reached its limit of 1 concurrent runs");

    firstPrompt.resolve();
    await expect(first.completion).resolves.toEqual({ status: "completed" });
    const failed = await fixture.capability.run(fixture.input);
    await expect(failed.completion).resolves.toEqual({ status: "failed", error: "model unavailable" });
    const afterFailure = await fixture.capability.run(fixture.input);
    await expect(afterFailure.completion).resolves.toEqual({ status: "completed" });

    expect(fixture.sessions.stop).toHaveBeenCalledTimes(3);
    await fixture.instance.dispose?.(AbortSignal.timeout(1_000));
  });

  it("isolates stale authority and session-start failures without consuming later admission", async () => {
    let failStart = true;
    const fixture = harness({
      maxConcurrentRunsPerPlugin: 1,
      startOneShotRun: () => failStart
        ? Promise.reject(new Error("runtime construction failed"))
        : Promise.resolve({ id: "session-recovered", completion: Promise.resolve() }),
    });

    await expect(fixture.capability.run(fixture.input))
      .rejects.toThrow("run-consumer could not start a PI session");
    failStart = false;
    fixture.setWorkspace({ ...workspace(), id: "workspace-replaced" });
    await expect(fixture.capability.run(fixture.input))
      .rejects.toThrow("run-consumer selected workspace is stale or unavailable");
    fixture.setWorkspace(workspace());
    const recovered = await fixture.capability.run(fixture.input);
    await expect(recovered.completion).resolves.toEqual({ status: "completed" });

    expect(fixture.sessions.startOneShotRun).toHaveBeenCalledTimes(2);
    await fixture.instance.dispose?.(AbortSignal.timeout(1_000));
  });

  it("reclaims a session when lifetime cancellation wins the final startup await", async () => {
    const started = deferred<{ id: string; completion: Promise<void> }>();
    const fixture = harness({ startOneShotRun: () => started.promise });

    const running = fixture.capability.run(fixture.input);
    await vi.waitFor(() => { expect(fixture.sessions.startOneShotRun).toHaveBeenCalledOnce(); });
    fixture.lifetime.abort(new DOMException("Plugin stopped", "AbortError"));
    started.resolve({ id: "session-late", completion: Promise.resolve() });

    await expect(running).rejects.toThrow("is no longer active");
    expect(fixture.sessions.abort).toHaveBeenCalledWith({
      id: "session-late",
      cwd: resolve("/repo/worktree"),
    });
    expect(fixture.sessions.stop).toHaveBeenCalledWith({
      id: "session-late",
      cwd: resolve("/repo/worktree"),
    });
    await fixture.instance.dispose?.(AbortSignal.timeout(1_000));
  });

  it("lets in-progress stop own cancellation instead of racing it with a late abort", async () => {
    const stopping = deferred();
    const fixture = harness();
    fixture.sessions.stop.mockImplementation(() => stopping.promise);

    const run = await fixture.capability.run(fixture.input);
    await vi.waitFor(() => { expect(fixture.sessions.stop).toHaveBeenCalledOnce(); });
    fixture.lifetime.abort(new DOMException("Plugin stopped", "AbortError"));
    stopping.resolve();

    await expect(run.completion).resolves.toEqual({ status: "completed" });
    expect(fixture.sessions.abort).not.toHaveBeenCalled();
    await fixture.instance.dispose?.(AbortSignal.timeout(1_000));
  });

  it("revokes admission, aborts active work, and waits for transcript-preserving shutdown cleanup", async () => {
    const prompt = deferred();
    const events: string[] = [];
    const fixture = harness({
      runCompletion: () => prompt.promise,
    });
    fixture.sessions.abort.mockImplementation(() => {
      events.push("abort");
      prompt.reject(new DOMException("Plugin stopped", "AbortError"));
      return Promise.resolve();
    });
    fixture.sessions.stop.mockImplementation(() => {
      events.push("stop");
      return Promise.resolve();
    });

    const run = await fixture.capability.run(fixture.input);
    fixture.lifetime.abort(new DOMException("Plugin lifetime ended", "AbortError"));

    await expect(run.completion).resolves.toEqual({ status: "cancelled" });
    await fixture.instance.dispose?.(AbortSignal.timeout(1_000));
    await expect(fixture.capability.run(fixture.input))
      .rejects.toThrow("run-consumer is no longer active");

    expect(events).toEqual(["abort", "stop"]);
    expect(fixture.sessions.abort).toHaveBeenCalledWith({
      id: run.sessionId,
      cwd: resolve("/repo/worktree"),
    });
    expect(fixture.sessions.stop).toHaveBeenCalledWith({
      id: run.sessionId,
      cwd: resolve("/repo/worktree"),
    });
  });
});
