import type { PiWebPlugin, PluginCapability, UiStylesCapabilityV1 } from "@jmfederico/pi-web/plugin-api";
import { createGitBrowserContributions } from "./git-panel.js";

const uiStylesCapability: PluginCapability<UiStylesCapabilityV1, 1> = {
  pluginId: "pi-web", id: "ui-styles", version: 1,
  parse: (value) => {
    if (typeof value !== "object" || value === null || !("cssText" in value) || typeof value.cssText !== "string") {
      throw new Error("PI WEB UI styles capability v1 requires cssText");
    }
    return { cssText: value.cssText };
  },
};

const plugin = {
  apiVersion: 4,
  name: "Git",
  requires: [uiStylesCapability],
  activate: ({ pluginId, runtimePluginId, html, svg }) => {
    let uiCssText = "";
    return {
      start: ({ capabilities }) => {
        uiCssText = capabilities.resolve(uiStylesCapability).cssText;
      },
      contributions: createGitBrowserContributions(pluginId, runtimePluginId, html, svg, () => uiCssText),
    };
  },
} satisfies PiWebPlugin;

export default plugin;
