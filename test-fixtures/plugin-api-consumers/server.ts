import type { ServerPluginPeer, PiWebServerPlugin } from "@jmfederico/pi-web/server-plugin-api";

const channelOnlyPeer: ServerPluginPeer = {
  openChannel: () => ({ receive: () => undefined }),
};

const plugin: PiWebServerPlugin = {
  apiVersion: 2,
  name: "Server declaration fixture",
  activate: (context) => {
    context.notices?.record({
      severity: "info",
      message: "Server declaration fixture activated",
      scope: { projectId: "fixture-project" },
      context: { phase: "activate" },
    });
    return {
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
