import { createEventBus } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../../../examples/session-bridge-plugin/src/server.js";
import type { ServerPluginPeerRequestContext } from "../../server-plugin-api.js";

afterEach(() => { vi.useRealTimers(); });

function setup() {
  const bus = createEventBus();
  const lifetime = new AbortController();
  const requestLifetime = new AbortController();
  const unsubscribe = vi.fn();
  const connection = {
    signal: lifetime.signal,
    on: (channel: string, handler: (data: unknown) => void) => {
      const off = bus.on(channel, handler);
      return () => { off(); unsubscribe(); };
    },
    emit: (channel: string, data: unknown) => { bus.emit(channel, data); },
    close: vi.fn(() => { lifetime.abort(); }),
  };
  const create = vi.fn(() => Promise.resolve({ sessionId: "created-session" }));
  const connect = vi.fn(() => Promise.resolve(connection));
  const activation = plugin.activate();
  activation.start({
    capabilities: { resolve: (capability) => capability.parse(capability.id === "pi-sessions"
      ? { version: 1, create, run: () => { throw new Error("run must not be used"); } }
      : { version: 1, connect }) },
    signal: new AbortController().signal,
  });
  const context: ServerPluginPeerRequestContext = {
    project: { id: "project", name: "Project", path: "/workspace" },
    workspace: { id: "workspace", projectId: "project", path: "/workspace", label: "Workspace", isMain: true },
    operation: "create", input: null, signal: requestLifetime.signal,
  };
  return { bus, lifetime, requestLifetime, connection, create, connect, activation, context, unsubscribe };
}

function reply(bus: ReturnType<typeof createEventBus>, error?: string) {
  return bus.on("session-bridge-example:greet", (data) => {
    if (typeof data !== "object" || data === null || !("requestId" in data)) throw new Error("Invalid greeting");
    const requestId = data.requestId;
    bus.emit("session-bridge-example:reply", { requestId: "unrelated", received: true });
    bus.emit("session-bridge-example:reply", { requestId, ...(error !== undefined ? { error } : { received: true }) });
  });
}

describe("session bridge example backend", () => {
  it.each(["create", "existing"])("subscribes before native synchronous receipt for %s and closes without run", async (operation) => {
    const fixture = setup();
    reply(fixture.bus);
    const result = await fixture.activation.peer.request({ ...fixture.context, operation, input: "selected-session" });
    const sessionId = operation === "create" ? "created-session" : "selected-session";
    expect(result).toMatchObject({ sessionId });
    expect(fixture.create).toHaveBeenCalledTimes(operation === "create" ? 1 : 0);
    if (operation === "create") expect(fixture.create).toHaveBeenCalledWith({ projectId: "project", workspaceId: "workspace" });
    expect(fixture.connect).toHaveBeenCalledWith({ projectId: "project", workspaceId: "workspace", sessionId });
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
    expect(fixture.connection.close).toHaveBeenCalledOnce();
  });

  it("reports companion errors with the created conversation id and cleans up", async () => {
    const fixture = setup();
    reply(fixture.bus, "Companion session is not ready");
    await expect(fixture.activation.peer.request(fixture.context)).rejects.toThrow("Session created-session: Companion session is not ready");
    expect(fixture.connection.close).toHaveBeenCalledOnce();
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
  });

  it("times out a missing companion without retrying or losing cleanup", async () => {
    vi.useFakeTimers();
    const fixture = setup();
    const result = fixture.activation.peer.request(fixture.context);
    const rejected = expect(result).rejects.toThrow("No companion receipt within 5 seconds");
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(fixture.create).toHaveBeenCalledOnce();
    expect(fixture.connection.close).toHaveBeenCalledOnce();
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["requestLifetime", "lifetime"] as const)("stops waiting on %s cancellation", async (kind) => {
    const fixture = setup();
    fixture.bus.on("session-bridge-example:greet", () => { fixture[kind].abort(); });
    await expect(fixture.activation.peer.request(fixture.context)).rejects.toThrow("receipt wait cancelled");
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
    expect(fixture.connection.close).toHaveBeenCalledOnce();
  });

  it("rejects missing explicit session selection before creating or connecting", async () => {
    const fixture = setup();
    await expect(fixture.activation.peer.request({ ...fixture.context, operation: "existing", input: null })).rejects.toThrow("full selected session id");
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.connect).not.toHaveBeenCalled();
  });
});
