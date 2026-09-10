import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "../api";
import {
  createPluginPeer,
  createPluginWorkspaceBackend,
  type PluginBackendChannelOpener,
  type PluginBackendRequester,
} from "./workspaceBackend";

const providerlessWorkspace: Workspace = {
  id: "workspace one",
  projectId: "project one",
  path: "/repo",
  label: "main",
  isMain: true,
  effectiveConfig: {},
};

const workspace: Workspace = {
  ...providerlessWorkspace,
  provider: {
    pluginId: "changes.owner",
    capabilities: { request: true, remove: false },
  },
};

describe("plugin workspace backend", () => {
  it("keeps the legacy helper owner-backed without paired package metadata", async () => {
    const request = vi.fn<PluginBackendRequester>(() => Promise.resolve({ files: [] }));
    const backend = createPluginWorkspaceBackend({
      registrationPluginId: "machine.remote.changes.owner",
      sourcePluginId: "changes.owner",
      backendRevision: "remote-r2",
    }, workspace, "remote one", request);
    if (backend === undefined) throw new Error("Expected an owner-backed workspace backend");

    await expect(backend.request("status", null)).resolves.toEqual({ files: [] });
    expect(Object.keys(backend)).toEqual(["request"]);
    expect(request).toHaveBeenCalledWith({
      pluginId: "changes.owner",
      backendRevision: "remote-r2",
      machineId: "remote one",
      projectId: "project one",
      workspaceId: "workspace one",
    }, "status", null);
  });

  it("omits the owner-backed helper when the contribution cannot service the current workspace", () => {
    const binding = {
      registrationPluginId: "machine.remote.changes.owner",
      sourcePluginId: "changes.owner",
      backendRevision: "remote-r2",
    };

    expect(createPluginWorkspaceBackend(binding, providerlessWorkspace, "remote one", vi.fn())).toBeUndefined();
    expect(createPluginWorkspaceBackend(binding, {
      ...workspace,
      provider: {
        pluginId: "different.owner",
        capabilities: { request: true, remove: false },
      },
    }, "remote one", vi.fn())).toBeUndefined();
    expect(createPluginWorkspaceBackend(binding, {
      ...workspace,
      provider: {
        pluginId: "changes.owner",
        capabilities: { request: false, remove: false },
      },
    }, "remote one", vi.fn())).toBeUndefined();
  });

  it("binds peer capabilities to the contribution source, revision, workspace, and machine", async () => {
    const request = vi.fn<PluginBackendRequester>(() => Promise.resolve({ files: [] }));
    const openChannel = vi.fn<PluginBackendChannelOpener>(() => Promise.resolve({
      closed: Promise.resolve({ code: 1000, reason: "done", wasClean: true }),
      send: vi.fn(),
      close: vi.fn(),
    }));
    const peer = createPluginPeer({
      registrationPluginId: "machine.remote.changes.owner",
      sourcePluginId: "changes.owner",
      backendRevision: "remote-r2",
      pairedRequestVersion: 1,
      pairedChannelVersion: 1,
    }, workspace, "remote one", request, openChannel);
    if (peer === undefined) throw new Error("Expected a plugin peer");

    const controller = new AbortController();
    expect(Object.keys(peer).sort()).toEqual(["openChannel", "request"]);
    await expect(peer.request?.("status", null, { signal: controller.signal })).resolves.toEqual({ files: [] });
    const channel = await peer.openChannel?.("watch", { cursor: 1 }, { signal: controller.signal, onData: vi.fn() });
    expect(channel).toHaveProperty("send");
    const target = {
      pluginId: "changes.owner",
      backendRevision: "remote-r2",
      machineId: "remote one",
      projectId: "project one",
      workspaceId: "workspace one",
    };
    expect(request).toHaveBeenCalledWith(target, "status", null, { signal: controller.signal });
    expect(openChannel).toHaveBeenCalledWith(target, "watch", { cursor: 1 }, expect.objectContaining({ signal: controller.signal }));
  });

  it("projects peer request and channel capabilities independently", () => {
    const requestOnly = createPluginPeer({
      registrationPluginId: "request-only",
      sourcePluginId: "request-only",
      backendRevision: "request-r1",
      pairedRequestVersion: 1,
    }, workspace, "local", vi.fn(), vi.fn());
    const channelOnly = createPluginPeer({
      registrationPluginId: "channel-only",
      sourcePluginId: "channel-only",
      backendRevision: "channel-r1",
      pairedChannelVersion: 1,
    }, workspace, "local", vi.fn(), vi.fn());

    expect(requestOnly).toHaveProperty("request");
    expect(requestOnly).not.toHaveProperty("openChannel");
    expect(channelOnly).toHaveProperty("openChannel");
    expect(channelOnly).not.toHaveProperty("request");
  });

  it("omits peer when the browser package advertises no peer capability", () => {
    const peer = createPluginPeer({
      registrationPluginId: "changes.owner",
      sourcePluginId: "changes.owner",
      backendRevision: "remote-r2",
    }, workspace, "remote-1", vi.fn(), vi.fn());

    expect(peer).toBeUndefined();
  });
});
