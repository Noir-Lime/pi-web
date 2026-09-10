import type { PluginCapability, ServerPluginPeer, PiWebServerPlugin } from "@jmfederico/pi-web/server-plugin-api";

interface FixtureDependencyV1 {
  readonly status: () => string;
}

const fixtureDependency = {
  pluginId: "fixture.provider",
  id: "status",
  version: 1,
  parse(value: unknown): FixtureDependencyV1 {
    if (!isFixtureDependency(value)) throw new Error("Fixture dependency is invalid");
    return Object.freeze({ status: () => value.status() });
  },
} satisfies PluginCapability<FixtureDependencyV1, 1>;

function isFixtureDependency(value: unknown): value is FixtureDependencyV1 {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "status") === "function";
}

const channelOnlyPeer: ServerPluginPeer = {
  openChannel: () => ({ receive: () => undefined }),
};

const plugin: PiWebServerPlugin = {
  apiVersion: 3,
  name: "Server declaration fixture",
  requires: [fixtureDependency],
  activate: (context) => {
    context.notices?.record({
      severity: "info",
      message: "Server declaration fixture activated",
      scope: { projectId: "fixture-project" },
      context: { phase: "activate" },
    });
    return {
      start: ({ capabilities, signal }) => {
        signal.throwIfAborted();
        context.logger.info(capabilities.resolve(fixtureDependency).status());
      },
      peer: {
        request: ({ workspace, operation, input }) => ({ workspaceId: workspace.id, operation, input }),
      },
      workspaceProvider: {
        probe: async () => "claim",
        list: async (project) => [{
          key: "main",
          path: project.path,
          label: project.name,
          isMain: true,
        }],
      },
    };
  },
};

export { channelOnlyPeer };
export default plugin;
