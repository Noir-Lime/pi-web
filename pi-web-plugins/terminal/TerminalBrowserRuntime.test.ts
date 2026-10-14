import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JsonValue, PluginPeer, PluginPeerChannel, PluginPeerChannelClose, PluginPeerChannelOptions, WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { TerminalBrowserRuntime } from "./TerminalBrowserRuntime";
import { InMemoryTerminalSelectionMemory } from "./terminalSelection";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Terminal browser runtime", () => {
  it("uses one scoped activity channel and zero idle list requests, including while hidden", async () => {
    const fixture = activityPeer();
    const context = workspaceContext("local", fixture.request);
    context.peer = fixture.peer;
    const requestRender = vi.fn();
    context.host.requestRender = requestRender;
    const runtime = new TerminalBrowserRuntime(new InMemoryTerminalSelectionMemory());
    runtime.activeTerminalBadge(context);
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.openChannel).toHaveBeenCalledOnce();
    expect(fixture.openChannel.mock.calls[0]?.slice(0, 2)).toEqual(["terminal.activity", null]);
    const connection = fixture.connections[0];
    if (connection === undefined) throw new Error("Expected activity connection");
    connection.options.onData({ activeCount: 2 });
    expect(runtime.activeTerminalBadge(context)).toBe(2);
    const renders = requestRender.mock.calls.length;
    connection.options.onData({ activeCount: 2 });
    expect(requestRender).toHaveBeenCalledTimes(renders);
    vi.stubGlobal("document", { hidden: true });
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fixture.request).not.toHaveBeenCalled();
    expect(fixture.openChannel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    connection.options.onData({ activeCount: 0 });
    expect(runtime.activeTerminalBadge(context)).toBeUndefined();
    runtime.dispose();
    expect(connection.options.signal?.aborted).toBe(true);
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it("backs off failed opens and reconnects a closed activity channel without polling", async () => {
    const fixture = activityPeer();
    fixture.openChannel.mockRejectedValueOnce(new Error("offline"));
    const context = workspaceContext("local", fixture.request);
    context.peer = fixture.peer;
    const runtime = new TerminalBrowserRuntime();
    runtime.activeTerminalBadge(context);
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.activeTerminalBadge(context)).toBe("!");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fixture.openChannel).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.openChannel).toHaveBeenCalledTimes(2);
    const connection = fixture.connections[0];
    if (connection === undefined) throw new Error("Expected activity connection");
    expect(runtime.activeTerminalBadge(context)).toBeUndefined();
    connection.finish({ code: 1006, reason: "offline", wasClean: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.activeTerminalBadge(context)).toBe("!");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fixture.openChannel).toHaveBeenCalledTimes(3);
    expect(fixture.request).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("cancels the previous workspace subscription and ignores its late data", async () => {
    const first = activityPeer();
    const next = activityPeer();
    const context = workspaceContext("local", first.request);
    context.peer = first.peer;
    const other = workspaceContext("remote", next.request);
    other.peer = next.peer;
    const runtime = new TerminalBrowserRuntime();
    runtime.activeTerminalBadge(context);
    await vi.advanceTimersByTimeAsync(0);
    runtime.activeTerminalBadge(other);
    await vi.advanceTimersByTimeAsync(0);
    const stale = first.connections[0];
    if (stale === undefined) throw new Error("Expected old activity connection");
    expect(stale.options.signal?.aborted).toBe(true);
    expect(stale.close).toHaveBeenCalledOnce();
    stale.options.onData({ activeCount: 99 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runtime.activeTerminalBadge(other)).toBeUndefined();
    expect(first.openChannel).toHaveBeenCalledOnce();
    expect(next.openChannel).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("cancels a pending open and closes its late channel after disposal", async () => {
    const fixture = activityPeer();
    let accept!: (channel: PluginPeerChannel) => void;
    fixture.openChannel.mockImplementationOnce(() => new Promise((resolve) => { accept = resolve; }));
    const context = workspaceContext("local", fixture.request);
    context.peer = fixture.peer;
    const runtime = new TerminalBrowserRuntime();
    runtime.activeTerminalBadge(context);
    await vi.advanceTimersByTimeAsync(0);
    runtime.dispose();
    const channel = { closed: new Promise<PluginPeerChannelClose>(() => undefined), send: vi.fn(), close: vi.fn() };
    accept(channel);
    await vi.advanceTimersByTimeAsync(0);
    expect(channel.close).toHaveBeenCalledOnce();
    expect(fixture.openChannel.mock.calls[0]?.[2].signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not subscribe from passive updates or explicit list refreshes", async () => {
    const fixture = activityPeer();
    fixture.request.mockResolvedValue([]);
    const context = workspaceContext("local", fixture.request);
    context.peer = fixture.peer;
    const runtime = new TerminalBrowserRuntime();
    await runtime.refresh(context);
    runtime.updateTerminals(context, []);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fixture.request).toHaveBeenCalledOnce();
    expect(fixture.openChannel).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    runtime.dispose();
  });

  it("keeps selection in plugin-owned memory and publishes canonical navigation first", () => {
    const memory = new InMemoryTerminalSelectionMemory();
    const runtime = new TerminalBrowserRuntime(memory);
    const remembered: (string | undefined)[] = [];
    const set = vi.fn();
    const context = workspaceContext("local", vi.fn(), { set });
    set.mockImplementation(() => { remembered.push(memory.latestTerminalId(runtime.selectionScope(context))); });
    runtime.selectTerminal(context, "terminal-2");
    expect(remembered).toEqual([undefined]);
    expect(memory.latestTerminalId(runtime.selectionScope(context))).toBe("terminal-2");
    expect(set).toHaveBeenCalledWith("terminal", "terminal-2", undefined);
    expect(runtime.selectedTerminalId(context)).toBe("terminal-2");
    runtime.selectTerminal(context, undefined, { replace: true });
    expect(remembered).toEqual([undefined, "terminal-2"]);
    expect(memory.latestTerminalId(runtime.selectionScope(context))).toBeUndefined();
    expect(set).toHaveBeenLastCalledWith("terminal", undefined, { replace: true });
  });

  it("does not update plugin selection when the host rejects stale navigation", () => {
    const memory = new InMemoryTerminalSelectionMemory();
    const runtime = new TerminalBrowserRuntime(memory);
    const context = workspaceContext("local", vi.fn(), { set: vi.fn(() => false) });
    const requestRender = vi.fn();
    context.host.requestRender = requestRender;
    memory.rememberTerminal(runtime.selectionScope(context), "terminal-old");
    expect(runtime.selectTerminal(context, "terminal-stale")).toBe(false);
    expect(memory.latestTerminalId(runtime.selectionScope(context))).toBe("terminal-old");
    expect(requestRender).not.toHaveBeenCalled();
  });

  it("separates authoritative scope from legacy path-keyed selection and moved paths", () => {
    const runtime = new TerminalBrowserRuntime();
    const first = workspaceContext("local", vi.fn());
    const second = { ...first, workspace: { ...first.workspace, id: "workspace-2", projectId: "project-2" } };
    expect(runtime.selectionScope(first)).toBe(runtime.selectionScope(second));
    expect(runtime.workspaceScope(first)).not.toBe(runtime.workspaceScope(second));
    expect(runtime.workspaceScope(first)).not.toBe(runtime.workspaceScope({ ...first, workspace: { ...first.workspace, path: "/repo-moved" } }));
  });

  it("requests a render after invalidation when the badge count is unchanged", async () => {
    const request = vi.fn((): Promise<JsonValue> => Promise.resolve([]));
    const context = workspaceContext("local", request);
    const runtime = new TerminalBrowserRuntime();
    const requestRender = vi.fn();
    context.host.requestRender = requestRender;
    await runtime.refresh(context);
    const renders = requestRender.mock.calls.length;
    await runtime.invalidate(context);
    expect(requestRender).toHaveBeenCalledTimes(renders + 1);
  });

  it("prefers restored navigation over remembered selection and fails closed without a peer", async () => {
    const runtime = new TerminalBrowserRuntime(new InMemoryTerminalSelectionMemory());
    const context = workspaceContext("remote", vi.fn(), { query: { terminal: "deep-link" } });
    runtime.selection.rememberTerminal(runtime.selectionScope(context), "remembered");
    expect(runtime.selectedTerminalId(context)).toBe("deep-link");
    Reflect.deleteProperty(context, "peer");
    await expect(runtime.refresh(context)).rejects.toThrow("Required Terminal peer is unavailable");
  });
});

function activityPeer() {
  const connections: { options: PluginPeerChannelOptions; channel: PluginPeerChannel; close: ReturnType<typeof vi.fn>; finish: (close: PluginPeerChannelClose) => void }[] = [];
  const request = vi.fn<NonNullable<PluginPeer["request"]>>();
  const openChannel = vi.fn<NonNullable<PluginPeer["openChannel"]>>((_operation, _input, options) => {
    let finish!: (close: PluginPeerChannelClose) => void;
    const close = vi.fn(() => { finish({ code: 1000, reason: "closed", wasClean: true }); });
    const channel: PluginPeerChannel = {
      closed: new Promise((resolve) => { finish = resolve; }), send: vi.fn(), close,
    };
    connections.push({ options, channel, close, finish });
    options.onData({ activeCount: 0 });
    return Promise.resolve(channel);
  });
  return { connections, request, openChannel, peer: { request, openChannel } };
}

function workspaceContext(machineId: string, request: NonNullable<PluginPeer["request"]>, navigation: Partial<NonNullable<WorkspacePanelContext["navigation"]>> = {}): WorkspacePanelContext {
  return {
    navigate: () => Promise.resolve(),
    machine: { id: machineId, name: machineId, kind: machineId === "local" ? "local" : "remote" },
    workspace: { id: "workspace-1", projectId: "project-1", path: "/repo", label: "main", isMain: true },
    files: { readFile: vi.fn(), listFiles: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), moveFile: vi.fn() },
    peer: { request }, host: { requestRender: vi.fn() },
    prompt: { insertText: vi.fn(), getText: vi.fn(() => ""), getSelection: vi.fn(() => null) },
    terminal: { open: vi.fn(), runCommand: vi.fn() },
    navigation: { version: 1, contributionId: "pi-web.terminal:workspace.terminal", query: navigation.query ?? {}, set: navigation.set ?? vi.fn() },
  };
}
