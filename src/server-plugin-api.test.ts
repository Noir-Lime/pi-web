import { readFile } from "node:fs/promises";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  JsonObject,
  PluginCapability,
  PluginCapabilityProvision,
  ServerPluginCapabilityResolver,
  ServerPluginPeer,
  ServerPluginPeerChannel,
  ServerPluginPeerChannelCloseContext,
  ServerPluginPeerChannelOpenContext,
  ServerPluginPeerRequestContext,
  ServerPluginPeerWorkspace,
  PiWebServerPlugin,
  ProjectInput,
  ProviderRemoveContext,
  ProviderRequestContext,
  ProviderWorkspace,
  ServerPluginActivation,
  ServerPluginActivationContext,
  ServerPluginExecFileRequest,
  ServerPluginExecFileResult,
  ServerPluginLogger,
  ServerPluginNoticeInput,
  ServerPluginStartContext,
  ServerPluginNoticeReporterV1,
  ServerPluginNoticeScope,
  WorkspaceProvider,
  WorkspaceRemovalPresentation,
  WorkspaceRemovePlan,
} from "@jmfederico/pi-web/server-plugin-api";

const project: ProjectInput = { id: "project-1", name: "Project", path: "/repo" };
const commandResult: ServerPluginExecFileResult = {
  exitCode: 0,
  signal: null,
  stdout: "ok",
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
};

interface FixtureCapability {
  readonly label: string;
}

const dependencyCapability = Object.freeze({
  pluginId: "fixture.provider",
  id: "service",
  version: 1,
  parse(value: unknown): FixtureCapability {
    if (typeof value !== "object" || value === null || !("label" in value)) {
      throw new Error("Fixture capability is invalid");
    }
    const label: unknown = value.label;
    if (typeof label !== "string") throw new Error("Fixture capability is invalid");
    return Object.freeze({ label });
  },
}) satisfies PluginCapability<FixtureCapability, 1>;

const providedCapability = Object.freeze({
  pluginId: "neutral-fixture",
  id: "snapshot",
  version: 2,
  parse: dependencyCapability.parse,
}) satisfies PluginCapability<FixtureCapability, 2>;

type IfEqual<Left, Right, Then, Else = never> =
  (<Value>(value: Value) => Value extends Left ? 1 : 2) extends
  (<Value>(value: Value) => Value extends Right ? 1 : 2) ? Then : Else;

type ReadonlyKeys<Value> = {
  [Key in keyof Value]-?: IfEqual<
    { [Property in Key]: Value[Property] },
    { -readonly [Property in Key]: Value[Property] },
    never,
    Key
  >;
}[keyof Value];

type WritableKeys<Value> = Exclude<keyof Value, ReadonlyKeys<Value>>;

describe("public server plugin API", () => {
  it("supports lifecycle-owned providers, peers, and typed capability composition", async () => {
    const observedSignals: AbortSignal[] = [];
    const observedLifetimes: AbortSignal[] = [];
    const provider: WorkspaceProvider = {
      fallback: false,
      probe(_project, signal) {
        observedSignals.push(signal);
        return Promise.resolve("claim");
      },
      list(_project, signal) {
        observedSignals.push(signal);
        return Promise.resolve([{
          key: "secondary",
          path: "/repo/secondary",
          label: "secondary",
          isMain: false,
          data: { privateRevision: 2 },
          publicMetadata: { changeId: "abc" },
          removal: { actionLabel: "Remove workspace", confirmation: "Remove secondary?" },
        }]);
      },
      request(context) {
        observedSignals.push(context.signal);
        return Promise.resolve({ operation: context.operation, input: context.input });
      },
      prepareRemove(context) {
        observedSignals.push(context.signal);
        return Promise.resolve({ title: "Remove secondary", command: "provider workspace remove secondary" });
      },
    };
    const plugin: PiWebServerPlugin = {
      apiVersion: 3,
      name: "Neutral contract fixture",
      requires: [dependencyCapability],
      activate: ({ lifetimeSignal }) => {
        observedLifetimes.push(lifetimeSignal);
        return {
          workspaceProvider: provider,
          peer: {
            request: (context) => {
              observedSignals.push(context.signal);
              return { operation: context.operation, workspaceId: context.workspace.id };
            },
          },
          provides: [{ capability: providedCapability, value: { label: "snapshot" } }],
          start: ({ capabilities, signal }) => {
            observedSignals.push(signal);
            if (capabilities.resolve(dependencyCapability).label !== "dependency") {
              throw new Error("Expected resolved fixture dependency");
            }
          },
          dispose: (signal) => { observedSignals.push(signal); },
          health: (signal) => {
            observedSignals.push(signal);
            return { status: "healthy", details: { executable: true } };
          },
        };
      },
    };
    const signal = AbortSignal.timeout(1_000);
    const settings: JsonObject = { mode: "test", nested: [1, true, null] };
    const lifetimeController = new AbortController();
    const activation = await plugin.activate({
      apiVersion: 3,
      pluginId: "neutral-fixture",
      packageRoot: "/plugins/neutral-fixture",
      settings,
      signal,
      notices: { version: 1, record() { /* no-op */ } },
      logger: {
        debug() { /* no-op */ },
        info() { /* no-op */ },
        warn() { /* no-op */ },
        error() { /* no-op */ },
      },
      execFile: () => Promise.resolve(commandResult),
      lifetimeSignal: lifetimeController.signal,
    });

    await exerciseActivation(activation, project, signal);

    expect(observedSignals).toHaveLength(8);
    expect(observedSignals.every((observed) => observed === signal)).toBe(true);
    expect(observedLifetimes).toEqual([lifetimeController.signal]);
  });

  it("keeps host inputs readonly and concrete services out of the declaration surface", async () => {
    expectTypeOf<keyof ServerPluginActivationContext>().toEqualTypeOf<
      "apiVersion" | "pluginId" | "packageRoot" | "logger" | "settings" | "notices" | "execFile" | "signal" | "lifetimeSignal"
    >();
    expectTypeOf<keyof ServerPluginNoticeReporterV1>().toEqualTypeOf<"version" | "record">();
    expectTypeOf<keyof ServerPluginNoticeInput>().toEqualTypeOf<"severity" | "message" | "scope" | "context">();
    expectTypeOf<keyof PiWebServerPlugin>().toEqualTypeOf<"apiVersion" | "name" | "requires" | "activate">();
    expectTypeOf<keyof PluginCapability>().toEqualTypeOf<"pluginId" | "id" | "version" | "parse">();
    expectTypeOf<keyof PluginCapabilityProvision>().toEqualTypeOf<"capability" | "value">();
    expectTypeOf<keyof ServerPluginCapabilityResolver>().toEqualTypeOf<"resolve">();
    expectTypeOf<keyof ServerPluginStartContext>().toEqualTypeOf<"capabilities" | "signal">();
    expectTypeOf<keyof ServerPluginActivation>().toEqualTypeOf<"workspaceProvider" | "peer" | "provides" | "start" | "dispose" | "health">();
    expectTypeOf<keyof ServerPluginNoticeScope>().toEqualTypeOf<"projectId" | "workspaceId" | "sessionId">();
    expectTypeOf<keyof WorkspaceProvider>().toEqualTypeOf<
      "fallback" | "probe" | "list" | "request" | "prepareRemove"
    >();
    expectTypeOf<keyof ServerPluginPeer>().toEqualTypeOf<"request" | "openChannel">();
    type EmptyNoticeScopeIsValid = Record<never, never> extends ServerPluginNoticeScope ? true : false;
    type ProjectNoticeScopeIsValid = { readonly projectId: string } extends ServerPluginNoticeScope ? true : false;
    type EmptyPeerIsValid = Record<never, never> extends ServerPluginPeer ? true : false;
    type PeerRequest = NonNullable<ServerPluginPeer["request"]>;
    type PeerChannel = NonNullable<ServerPluginPeer["openChannel"]>;
    type RequestOnlyPeerIsValid = { request: PeerRequest } extends ServerPluginPeer ? true : false;
    type ChannelOnlyPeerIsValid = { openChannel: PeerChannel } extends ServerPluginPeer ? true : false;
    expectTypeOf<EmptyNoticeScopeIsValid>().toEqualTypeOf<false>();
    expectTypeOf<ProjectNoticeScopeIsValid>().toEqualTypeOf<true>();
    expectTypeOf<EmptyPeerIsValid>().toEqualTypeOf<false>();
    expectTypeOf<RequestOnlyPeerIsValid>().toEqualTypeOf<true>();
    expectTypeOf<ChannelOnlyPeerIsValid>().toEqualTypeOf<true>();
    const requestOnly: ServerPluginPeer = { request: () => null };
    const channelOnly: ServerPluginPeer = {
      openChannel: () => ({ receive: () => undefined }),
    };
    expect(typeof requestOnly.request).toBe("function");
    expect(typeof channelOnly.openChannel).toBe("function");
    expectTypeOf<keyof ServerPluginPeerChannel>().toEqualTypeOf<"receive" | "closed" | "close">();
    expectTypeOf<keyof ServerPluginPeerChannelOpenContext>().toEqualTypeOf<"project" | "workspace" | "operation" | "input" | "signal" | "send">();
    expectTypeOf<keyof ServerPluginPeerChannelCloseContext>().toEqualTypeOf<"code" | "reason" | "signal">();
    expectTypeOf<keyof ServerPluginPeerRequestContext>().toEqualTypeOf<
      "project" | "workspace" | "operation" | "input" | "signal"
    >();
    expectTypeOf<keyof ServerPluginExecFileRequest>().toEqualTypeOf<
      "file" | "args" | "cwd" | "env" | "unsetEnv" | "timeoutMs" | "signal"
    >();
    expectTypeOf<ReadonlyKeys<ServerPluginActivationContext>>().toEqualTypeOf<keyof ServerPluginActivationContext>();
    expectTypeOf<ReadonlyKeys<PluginCapability>>().toEqualTypeOf<keyof PluginCapability>();
    expectTypeOf<ReadonlyKeys<PluginCapabilityProvision>>().toEqualTypeOf<keyof PluginCapabilityProvision>();
    expectTypeOf<ReadonlyKeys<ServerPluginCapabilityResolver>>().toEqualTypeOf<keyof ServerPluginCapabilityResolver>();
    expectTypeOf<ReadonlyKeys<ServerPluginStartContext>>().toEqualTypeOf<keyof ServerPluginStartContext>();
    expectTypeOf<ReadonlyKeys<ServerPluginLogger>>().toEqualTypeOf<keyof ServerPluginLogger>();
    expectTypeOf<ReadonlyKeys<ServerPluginNoticeReporterV1>>().toEqualTypeOf<keyof ServerPluginNoticeReporterV1>();
    expectTypeOf<ReadonlyKeys<ServerPluginNoticeInput>>().toEqualTypeOf<keyof ServerPluginNoticeInput>();
    expectTypeOf<ReadonlyKeys<ServerPluginNoticeScope>>().toEqualTypeOf<keyof ServerPluginNoticeScope>();
    expectTypeOf<ReadonlyKeys<ProjectInput>>().toEqualTypeOf<keyof ProjectInput>();
    expectTypeOf<ReadonlyKeys<ProviderRequestContext>>().toEqualTypeOf<keyof ProviderRequestContext>();
    expectTypeOf<ReadonlyKeys<ProviderRemoveContext>>().toEqualTypeOf<keyof ProviderRemoveContext>();
    expectTypeOf<ReadonlyKeys<ServerPluginPeerRequestContext>>().toEqualTypeOf<keyof ServerPluginPeerRequestContext>();
    expectTypeOf<ReadonlyKeys<ServerPluginPeerChannelOpenContext>>().toEqualTypeOf<keyof ServerPluginPeerChannelOpenContext>();
    expectTypeOf<ReadonlyKeys<ServerPluginPeerChannelCloseContext>>().toEqualTypeOf<keyof ServerPluginPeerChannelCloseContext>();
    expectTypeOf<ReadonlyKeys<ServerPluginPeerWorkspace>>().toEqualTypeOf<keyof ServerPluginPeerWorkspace>();
    expectTypeOf<ReadonlyKeys<ProviderRequestContext["workspace"]>>().toEqualTypeOf<keyof ProviderWorkspace>();
    expectTypeOf<ReadonlyKeys<WorkspaceRemovalPresentation>>().toEqualTypeOf<keyof WorkspaceRemovalPresentation>();
    expectTypeOf<keyof WorkspaceRemovalPresentation>().toEqualTypeOf<"actionLabel" | "confirmation">();
    expectTypeOf<WritableKeys<ProviderWorkspace>>().toEqualTypeOf<keyof ProviderWorkspace>();
    expectTypeOf<WritableKeys<WorkspaceRemovePlan>>().toEqualTypeOf<keyof WorkspaceRemovePlan>();
    expectTypeOf<WritableKeys<ServerPluginActivation>>().toEqualTypeOf<keyof ServerPluginActivation>();

    const source = await readFile("src/server-plugin-api.ts", "utf8");
    expect(source).not.toMatch(/\b(?:Fastify|WorkspaceService|ProjectService|TerminalService|SessionDaemonClient)\b/u);
    expect(source).not.toMatch(/event\s*bus|service\s*locator|registerRoute/iu);
    expect(source).toContain('from "./shared/pluginApiTypes.js";');
    expect(source).not.toContain("./shared/apiTypes.js");
  });
});

async function exerciseActivation(activation: ServerPluginActivation, input: ProjectInput, signal: AbortSignal): Promise<void> {
  await activation.start?.({
    capabilities: { resolve: <Value>(capability: PluginCapability<Value>) => capability.parse({ label: "dependency" }) },
    signal,
  });
  const provider = activation.workspaceProvider;
  if (provider === undefined) throw new Error("Expected fixture workspace provider");
  await provider.probe(input, signal);
  const [workspace] = await provider.list(input, signal);
  if (workspace === undefined) throw new Error("Expected fixture workspace");
  const request: ProviderRequestContext = { project: input, workspace, operation: "status", input: { paths: [] }, signal };
  await provider.request?.(request);
  await provider.prepareRemove?.({ project: input, workspace, signal });
  await activation.peer?.request?.({
    project: input,
    workspace: {
      id: "workspace-1",
      projectId: input.id,
      path: workspace.path,
      label: workspace.label,
      isMain: workspace.isMain,
      provider: {
        pluginId: "neutral-fixture",
        capabilities: { request: true, remove: false },
      },
    },
    operation: "status",
    input: null,
    signal,
  });
  await activation.health?.(signal);
  await activation.dispose?.(signal);
}
