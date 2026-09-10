import type { PiWebPlugin } from "../types";
import { createCoreActions } from "./actions";
export const corePlugin: PiWebPlugin = {
  apiVersion: 3,
  name: "PI WEB Core",
  activate: () => ({
    contributions: {
      actions: createCoreActions(),
    },
  }),
};
