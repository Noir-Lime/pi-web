// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { PluginStyleRegistry, PluginStylesController, type PluginStylesheetLoader } from "./styleRegistry";

const a = { id: "test:a", url: "https://example.test/a.css" };
const b = { id: "test:b", url: "https://example.test/b.css" };

function deferredSheet() {
  let resolve!: (sheet: CSSStyleSheet) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<CSSStyleSheet>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function shadowRoot(mode: ShadowRootMode = "open") {
  return document.createElement("div").attachShadow({ mode });
}

afterEach(() => { document.body.replaceChildren(); });

describe("PluginStyleRegistry", () => {
  it("shares one loaded sheet per file across the document, existing and later closed roots", async () => {
    const sheet = new CSSStyleSheet();
    const load = vi.fn<PluginStylesheetLoader>().mockResolvedValue(sheet);
    const registry = new PluginStyleRegistry(load);
    const root = shadowRoot();
    const local = new CSSStyleSheet();
    root.adoptedStyleSheets = [local];
    const releaseDocument = registry.registerRoot(document);
    const releaseRoot = registry.registerRoot(root);
    await registry.setContributions([a, { ...a, id: "test:alias" }]);
    const later = shadowRoot("closed");
    registry.registerRoot(later);

    expect(load).toHaveBeenCalledTimes(1);
    expect(document.adoptedStyleSheets).toEqual([sheet]);
    expect(root.adoptedStyleSheets).toEqual([local, sheet]);
    expect(later.adoptedStyleSheets).toEqual([sheet]);
    releaseRoot();
    releaseRoot();
    releaseDocument();
    expect(root.adoptedStyleSheets).toEqual([local]);
    expect(document.adoptedStyleSheets).toEqual([]);
    registry.clear();
    expect(later.adoptedStyleSheets).toEqual([]);
  });

  it("orders by order then identity, not completion, without disturbing component sheets", async () => {
    const first = deferredSheet();
    const second = deferredSheet();
    const registry = new PluginStyleRegistry((url) => url === a.url ? first.promise : second.promise);
    const root = shadowRoot();
    registry.registerRoot(root);
    const update = registry.setContributions([b, a]);
    const aSheet = new CSSStyleSheet();
    const bSheet = new CSSStyleSheet();
    second.resolve(bSheet);
    first.resolve(aSheet);
    await update;
    expect(root.adoptedStyleSheets).toEqual([aSheet, bSheet]);
    const local = new CSSStyleSheet();
    root.adoptedStyleSheets = [local, ...root.adoptedStyleSheets];
    await registry.setContributions([{ ...a, order: 20 }, { ...b, order: 10 }]);
    expect(root.adoptedStyleSheets).toEqual([local, bSheet, aSheet]);
    registry.clear();
  });

  it("removes inactive theme rules immediately and ignores late obsolete loads", async () => {
    const pending = deferredSheet();
    const oldSheet = new CSSStyleSheet();
    const nextSheet = new CSSStyleSheet();
    const signals: AbortSignal[] = [];
    const registry = new PluginStyleRegistry((url, signal) => {
      signals.push(signal);
      return url === a.url ? Promise.resolve(oldSheet) : pending.promise;
    });
    const root = shadowRoot();
    registry.registerRoot(root);
    await registry.setContributions([a]);
    const update = registry.setContributions([b]);
    expect(root.adoptedStyleSheets).toEqual([]);
    await registry.setContributions([]);
    pending.resolve(nextSheet);
    await update;
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(root.adoptedStyleSheets).toEqual([]);
    registry.clear();
  });

  it("attributes failures, avoids partial adoption, and permits retry", async () => {
    const failed = deferredSheet();
    const aSheet = new CSSStyleSheet();
    const bSheet = new CSSStyleSheet();
    const load = vi.fn<PluginStylesheetLoader>()
      .mockResolvedValueOnce(aSheet)
      .mockReturnValueOnce(failed.promise)
      .mockResolvedValueOnce(bSheet);
    const registry = new PluginStyleRegistry(load);
    const root = shadowRoot();
    registry.registerRoot(root);
    const update = registry.setContributions([a, b]);
    const failure = expect(update).rejects.toThrow("Failed to load stylesheet test:b (https://example.test/b.css)");
    failed.reject(new Error("network failed"));
    await failure;
    expect(root.adoptedStyleSheets).toEqual([]);
    await registry.setContributions([a, b]);
    expect(load).toHaveBeenCalledTimes(3);
    expect(root.adoptedStyleSheets).toEqual([aSheet, bSheet]);
    registry.clear();
  });

  it("reference counts root registrations and invalidates old releases after clear", async () => {
    const sheet = new CSSStyleSheet();
    const registry = new PluginStyleRegistry(() => Promise.resolve(sheet));
    const root = shadowRoot();
    const firstRelease = registry.registerRoot(root);
    const secondRelease = registry.registerRoot(root);
    await registry.setContributions([a]);
    firstRelease();
    expect(root.adoptedStyleSheets).toEqual([sheet]);
    registry.clear();
    const currentRelease = registry.registerRoot(root);
    await registry.setContributions([a]);
    secondRelease();
    expect(root.adoptedStyleSheets).toEqual([sheet]);
    currentRelease();
    expect(root.adoptedStyleSheets).toEqual([]);
    registry.clear();
  });

  it("rejects duplicate identities and non-file URLs without changing active rules", async () => {
    const sheet = new CSSStyleSheet();
    const registry = new PluginStyleRegistry(() => Promise.resolve(sheet));
    const root = shadowRoot();
    registry.registerRoot(root);
    await registry.setContributions([a]);
    await expect(registry.setContributions([a, a])).rejects.toThrow("Duplicate stylesheet contribution");
    await expect(registry.setContributions([{ ...a, url: "data:text/css,body{}" }])).rejects.toThrow("HTTP(S) file URL");
    expect(root.adoptedStyleSheets).toEqual([sheet]);
    registry.clear();
  });
});

it("integrates with the normal Lit root lifecycle, including reconnecting", async () => {
  const registry = new PluginStyleRegistry(() => Promise.resolve(new CSSStyleSheet()));
  class StyledElement extends LitElement {
    constructor() {
      super();
      new PluginStylesController(this, registry);
    }
    override render() { return html`<button>Example</button>`; }
  }
  customElements.define("test-plugin-styles-lifecycle", StyledElement);
  const element = new StyledElement();
  document.body.append(element);
  await element.updateComplete;
  await registry.setContributions([a]);
  const root = element.shadowRoot;
  if (root === null) throw new Error("Lit did not create its shadow root");
  const [sheet] = root.adoptedStyleSheets;
  expect(sheet).toBeDefined();
  element.remove();
  expect(root.adoptedStyleSheets).toEqual([]);
  document.body.append(element);
  await element.updateComplete;
  expect(root.adoptedStyleSheets).toEqual([sheet]);
  element.remove();
  await registry.setContributions([]);
  document.body.append(element);
  await element.updateComplete;
  expect(root.adoptedStyleSheets).toEqual([]);
  registry.clear();
});
