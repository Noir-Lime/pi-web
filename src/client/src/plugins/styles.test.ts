// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { PluginStyleRegistry } from "./styleRegistry";
import { PluginStyleRuntime } from "./styles";

const plugin = { id: "plugin:global", url: "https://plugins.test/global.css" };
const dark = { id: "themes:dark:file", url: "https://plugins.test/dark.css" };
const light = { id: "themes:light:file", url: "https://plugins.test/light.css" };

afterEach(() => { document.adoptedStyleSheets = []; });

it("publishes plugin and selected-theme files to the document and participating roots, then cleans up", async () => {
  const sheets = new Map([plugin, dark, light].map((file) => [file.url, new CSSStyleSheet()]));
  const load = vi.fn((url: string) => {
    const sheet = sheets.get(url);
    if (sheet === undefined) throw new Error(`Unexpected URL ${url}`);
    return Promise.resolve(sheet);
  });
  const registry = new PluginStyleRegistry(load);
  const report = vi.fn();
  const runtime = new PluginStyleRuntime(registry, report);
  const root = document.createElement("div").attachShadow({ mode: "closed" });
  registry.registerRoot(root);
  runtime.connect(document);
  runtime.update([plugin, dark]);
  await vi.waitFor(() => { expect(root.adoptedStyleSheets).toEqual([sheets.get(plugin.url), sheets.get(dark.url)]); });
  runtime.update([plugin, dark]);
  expect(load).toHaveBeenCalledTimes(2);
  runtime.update([plugin, light]);
  expect(root.adoptedStyleSheets).not.toContain(sheets.get(dark.url));
  await vi.waitFor(() => { expect(document.adoptedStyleSheets).toEqual([sheets.get(plugin.url), sheets.get(light.url)]); });
  expect(report).not.toHaveBeenCalled();
  runtime.disconnect();
  expect(root.adoptedStyleSheets).toEqual([]);
  expect(document.adoptedStyleSheets).toEqual([]);
});

it("reports active publication failures once without retrying on every app render", async () => {
  const failure = new Error("network failed");
  const registry = new PluginStyleRegistry(() => Promise.reject(failure));
  const report = vi.fn();
  const runtime = new PluginStyleRuntime(registry, report);
  runtime.connect(document);
  runtime.update([plugin]);
  await vi.waitFor(() => { expect(report).toHaveBeenCalledTimes(1); });
  expect(report.mock.calls[0]?.[0]).toMatchObject({ cause: failure });
  runtime.update([plugin]);
  expect(report).toHaveBeenCalledTimes(1);
  runtime.disconnect();
});

it("does not report aborted or failed work after a selection replacement or shutdown", async () => {
  let reject!: (error: Error) => void;
  const registry = new PluginStyleRegistry(() => new Promise((_resolve, fail) => { reject = fail; }));
  const report = vi.fn();
  const runtime = new PluginStyleRuntime(registry, report);
  runtime.connect(document);
  runtime.update([dark]);
  await Promise.resolve();
  runtime.update([]);
  reject(new Error("superseded"));
  await vi.waitFor(() => { expect(document.adoptedStyleSheets).toEqual([]); });
  runtime.disconnect();
  expect(report).not.toHaveBeenCalled();
});
