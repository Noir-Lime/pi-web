import { PI_WEB_HOST_STATE_CAPABILITY } from "../../server-plugin-api.js";
import {
  createFileServerPluginStatePersistence,
  serverPluginStateFilePath,
  ServerPluginStateStore,
} from "../storage/serverPluginStateStore.js";
import type { ServerPluginHostCapabilityContext, ServerPluginHostCapabilityFactory } from "./serverPluginRuntime.js";

export interface CreateServerPluginStateCapabilityOptions {
  readonly dataDir: string;
}

/** Creates the state v1 host factory; each declaring plugin receives one isolated store. */
export function createServerPluginStateCapabilityFactory(
  options: CreateServerPluginStateCapabilityOptions,
): ServerPluginHostCapabilityFactory {
  return Object.freeze({
    capability: PI_WEB_HOST_STATE_CAPABILITY,
    create(context: ServerPluginHostCapabilityContext) {
      const filePath = serverPluginStateFilePath(options.dataDir, context.pluginId);
      const store = new ServerPluginStateStore({
        pluginId: context.pluginId,
        lifetimeSignal: context.lifetimeSignal,
        persistence: createFileServerPluginStatePersistence(filePath),
      });
      return Object.freeze({
        value: store.capability(),
        dispose: () => store.close(),
      });
    },
  });
}
