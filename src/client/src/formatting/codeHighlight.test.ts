// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { html } from "lit";
import type { TokenHighlightedCode } from "../../../../pi-web-plugins/code-highlight/TokenHighlightedCode";
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

async function mount(text: string, configure?: (registry: PluginRegistry) => Promise<void>) {
  const registry = new PluginRegistry();
  await registry.register({ id: "code-highlight", plugin: adaptPublicPlugin(plugin) });
  await configure?.(registry);
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

it("extends the one Highlighted renderer with plugin grammars and filename matching", async () => {
  const source = 'let x = "<script>";';
  const view = await mount(`\`\`\`nix\n${source}\n\`\`\``, async (registry) => {
    expect(registry.contentRendering.listRenderers({ machineId: "local", text: source, language: "nix" })).toEqual([]);
    await registry.register({ id: "nix-grammar", plugin: {
      apiVersion: 5, name: "Nix grammar", activate: () => ({ contributions: { syntaxHighlighters: [{
        id: "nix", languages: ["nix"], fileExtensions: ["nix"], highlight: () => [{ from: 0, to: 3, kind: "keyword" }],
      }] } }),
    } });
    expect(registry.contentRendering.listRenderers({ machineId: "local", text: source, filePath: "flake.nix" }))
      .toEqual([{ id: "code-highlight:highlighted", label: "Highlighted", title: "Highlighted", renderMode: "automatic" }]);
  });
  const host = view.renderRoot.querySelector<ContentRendererHost>("pi-web-content-renderer");
  if (host === null) throw new Error("Expected Highlighted renderer");
  await host.updateComplete;
  const preview = host.renderRoot.querySelector<TokenHighlightedCode>("pi-web-token-highlighted-code");
  if (preview === null) throw new Error("Expected grammar tokens in the bundled renderer");
  await vi.waitFor(() => { expect(preview.renderRoot.querySelector(".hljs-keyword")?.textContent).toBe("let"); });
  expect(preview.renderRoot.querySelector("code")?.textContent).toBe(source);
  expect(preview.renderRoot.querySelector("script")).toBeNull();
  expect(host.renderRoot.querySelector("select")).toBeNull();
});

it("offers two independent highlighting systems and defaults to the last discovered one", async () => {
  const view = await mount("```js\nconst x = 1;\n```", async (registry) => {
    await registry.register({ id: "other-highlighter", plugin: {
      apiVersion: 5, name: "Other highlighting", activate: () => ({ contributions: { contentRenderers: [{
        id: "highlighted", title: "Other highlighting", languages: ["js"], renderMode: "automatic",
        render: ({ text }) => html`<code class="other-highlight">${text}</code>`,
      }] } }),
    } });
  });
  const host = view.renderRoot.querySelector<ContentRendererHost>("pi-web-content-renderer");
  if (host === null) throw new Error("Expected renderer host");
  await host.updateComplete;
  expect(host.renderRoot.querySelector("select")).toBeNull();
  const views = [...host.renderRoot.querySelectorAll<HTMLButtonElement>('.views button')];
  expect(views.map((view) => view.textContent.trim())).toEqual(["Highlighted", "Other highlighting", "Raw"]);
  expect(views.map((view) => view.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  expect(host.renderRoot.querySelector(".other-highlight")?.textContent).toBe("const x = 1;");
  views[0]?.click();
  await host.updateComplete;
  expect(views.map((view) => view.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
  expect(host.renderRoot.querySelector("pi-web-highlighted-code")).not.toBeNull();
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
