// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { PluginRegistry } from "../plugins/registry";
import { adaptPublicPlugin } from "../plugins/publicContext";
import { FormattedText } from "../components/FormattedText";
import { ContentRendererHost } from "../components/ContentRendererHost";
import { HighlightedCode } from "../../../../pi-web-plugins/code-highlight/HighlightedCode";
import plugin from "../../../../pi-web-plugins/code-highlight/pi-web-plugin";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

async function mount(text: string) {
  const registry = new PluginRegistry();
  await registry.register({ id: "code-highlight", plugin: adaptPublicPlugin(plugin) });
  const view = new FormattedText();
  view.text = text;
  view.contentRendering = registry.getChatContentRendering(view.machineId);
  document.body.append(view);
  await view.updateComplete;
  return view;
}

it("highlights completed chat fences automatically, preserves source safely, and allows raw mode", async () => {
  const source = 'const message = "<img src=x onerror=alert(1)>";';
  const view = await mount(`\`\`\`JS\n${source}\n\`\`\``);
  const host = view.renderRoot.querySelector<ContentRendererHost>("pi-web-content-renderer");
  if (host === null) throw new Error("Expected an automatic renderer host");
  await host.updateComplete;
  const preview = host.renderRoot.querySelector<HighlightedCode>("pi-web-highlighted-code");
  if (preview === null) throw new Error("Expected highlighted code without clicking Render");
  await preview.updateComplete;
  expect(preview.renderRoot.querySelector("code")?.textContent).toBe(source);
  expect(preview.renderRoot.querySelector(".hljs-keyword")?.textContent).toBe("const");
  expect(preview.renderRoot.querySelector(".hljs-string")?.textContent).toContain("<img");
  expect(preview.renderRoot.querySelector("img, script")).toBeNull();

  const raw = [...host.renderRoot.querySelectorAll("button")].find((button) => button.textContent.trim() === "Raw");
  if (raw === undefined) throw new Error("Expected Raw control");
  raw.click();
  await host.updateComplete;
  expect(host.renderRoot.querySelector("pre code")?.textContent).toBe(source);
  expect(host.renderRoot.querySelector("pi-web-highlighted-code")).toBeNull();
});

it.each([
  "```unknown-language\nconst a = 1;\n```",
  "```js\nconst a = 1;",
  "```\nconst a = 1;\n```",
  "```mermaid\ngraph TD; A-->B\n```",
])("keeps unsupported, incomplete, unlabelled and Mermaid fences as source: %s", async (text) => {
  const view = await mount(text);
  expect(view.renderRoot.querySelector("pi-web-content-renderer")).toBeNull();
  expect(view.renderRoot.querySelector("pre code")).not.toBeNull();
});

it.each(["python", "ts", "bash", "json", "html", "css", "rust", "go", "sql", "diff"])("supports common language %s", async (language) => {
  const view = await mount(`\`\`\`${language}\nsample\n\`\`\``);
  expect(view.renderRoot.querySelector("pi-web-content-renderer")).not.toBeNull();
});
