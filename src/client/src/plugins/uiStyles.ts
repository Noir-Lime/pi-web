import type { UiStylesCapabilityV1 } from "../../../plugin-api";
import { uiButtonStyles, uiTabStyles, uiToolbarStyles } from "../components/ui/controlStyles";
import { uiFileListStyles } from "../components/ui/fileListStyles";
import type { PluginCapability } from "./types";

export const uiStylesCapability: UiStylesCapabilityV1 = Object.freeze({
  cssText: [uiButtonStyles, uiToolbarStyles, uiTabStyles, uiFileListStyles].map((styles) => styles.cssText).join("\n"),
});

export const uiStylesCapabilityToken: PluginCapability<UiStylesCapabilityV1> = {
  pluginId: "pi-web", id: "ui-styles", version: 1,
  parse: (value) => {
    if (typeof value !== "object" || value === null || !("cssText" in value) || typeof value.cssText !== "string") {
      throw new Error("UI styles capability v1 is unavailable");
    }
    return Object.freeze({ cssText: value.cssText });
  },
};
