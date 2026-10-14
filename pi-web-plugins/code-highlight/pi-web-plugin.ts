import type { PiWebPlugin } from "@jmfederico/pi-web/plugin-api";
import hljs from "highlight.js/lib/common";
import { HighlightedCode } from "./HighlightedCode";

const plugin = {
  apiVersion: 4,
  name: "Code highlighting",
  requires: [{ pluginId: "pi-web", id: "content-rendering", version: 1, parse: () => undefined }],
  activate: ({ html }) => {
    if (customElements.get("pi-web-highlighted-code") === undefined) customElements.define("pi-web-highlighted-code", HighlightedCode);
    return {
      contributions: {
        // The renderer input is language-independent, so each grammar owns its
        // selector aliases and captures the language used to highlight it.
        contentRenderers: hljs.listLanguages().map((language) => ({
          id: language,
          // Some library aliases (e.g. c#) are not valid host selectors.
          languages: [language, ...(hljs.getLanguage(language)?.aliases ?? [])].filter((alias) => /^[a-z0-9][a-z0-9_+.-]*$/iu.test(alias)),
          renderMode: "automatic" as const,
          render: ({ text }) => html`<pi-web-highlighted-code
            .markup=${hljs.highlight(text, { language, ignoreIllegals: true }).value}
          ></pi-web-highlighted-code>`,
        })),
      },
    };
  },
} satisfies PiWebPlugin;

export default plugin;
