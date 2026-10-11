// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { html } from "lit";
import type { ContentRendererContribution } from "../../../plugin-api";
import type { ContentRendererChoice } from "../plugins/contentRenderers";
import { ContentRendererHost } from "./ContentRendererHost";
import { writeClipboardText } from "../clipboard";

vi.mock("../clipboard", () => ({ writeClipboardText: vi.fn().mockResolvedValue(true) }));

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function hostWith(choices: readonly ContentRendererChoice[]): ContentRendererHost {
  const host = new ContentRendererHost();
  host.text = "source";
  host.choices = choices;
  return host;
}

function automaticHost(draw: ContentRendererContribution["render"]): ContentRendererHost {
  return hostWith([{ id: "automatic", label: "Automatic", renderer: { id: "automatic", renderMode: "automatic", render: draw } }]);
}

function setDetailsOpen(details: HTMLDetailsElement, open: boolean): void {
  details.open = open;
}

function button(host: ContentRendererHost, label: string): HTMLButtonElement {
  const found = [...host.renderRoot.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent.trim() === label);
  if (found === undefined) throw new Error(`Missing ${label} button`);
  return found;
}

it("shows the renderer label and an accessible Copy icon without activating a manual preview", async () => {
  const draw = vi.fn<ContentRendererContribution["render"]>(() => html`<b>Preview</b>`);
  const host = hostWith([{ id: "manual", label: "Mermaid / diagram", renderer: { id: "manual", render: draw } }]);
  document.body.append(host);
  await host.updateComplete;
  expect(host.renderRoot.querySelector(".code-block-frame > .code-block-header .code-block-label")?.textContent).toBe("Mermaid / diagram");
  expect(draw).not.toHaveBeenCalled();
  const copy = button(host, "Copy source");
  expect(copy.textContent).toBe("⧉");
  expect(copy.getAttribute("title")).toBe("Copy source");
  expect(copy.querySelector('span[aria-hidden="true"]')).not.toBeNull();
  expect(copy.closest(".code-block-header")?.nextElementSibling?.id).toBe("content");
  button(host, "Render").click();
  await host.updateComplete;
  expect(host.renderRoot.querySelector(".code-block-label")?.textContent).toBe("Mermaid / diagram");
  expect(host.renderRoot.querySelector("b")?.textContent).toBe("Preview");
  expect(host.renderRoot.querySelector(".copy")).toBe(copy);
});

it("copies source from a visible preview and retains accessible success/failure feedback on the icon", async () => {
  const draw = vi.fn<ContentRendererContribution["render"]>(() => html`<b>Rendered diagram</b>`);
  const host = automaticHost(draw);
  document.body.append(host);
  await host.updateComplete;
  const copy = button(host, "Copy source");
  copy.click();
  await host.updateComplete;
  await host.updateComplete;
  expect(writeClipboardText).toHaveBeenCalledWith("source");
  expect(copy.textContent).toBe("✓");
  expect(copy.getAttribute("aria-label")).toBe("Copied source");
  expect(copy.getAttribute("title")).toBe("Copied source");
  expect(host.renderRoot.querySelector('[role="status"]')?.textContent).toBe("Copied source");

  vi.mocked(writeClipboardText).mockResolvedValueOnce(false);
  copy.click();
  await host.updateComplete;
  await host.updateComplete;
  expect(copy.textContent).toBe("⧉");
  expect(copy.getAttribute("aria-label")).toBe("Failed to copy source");
  expect(copy.getAttribute("title")).toBe("Failed to copy source");
  expect(host.renderRoot.querySelector('[role="status"]')?.textContent).toBe("Failed to copy source");
  expect(host.renderRoot.querySelector("b")?.textContent).toBe("Rendered diagram");
  expect(draw).toHaveBeenCalledOnce();
});

it("keeps consumer-owned external controls outside the standard embedded frame", async () => {
  const host = automaticHost(() => html`<b>Preview</b>`);
  host.externalControls = true;
  document.body.append(host);
  await host.updateComplete;
  expect(host.renderRoot.querySelector(".code-block-frame, .code-block-header, .code-block-copy")).toBeNull();
  expect(host.renderRoot.querySelector("b")?.textContent).toBe("Preview");
});

it("attaches source-policy modifiers only to raw source, never to preview content or its ancestors", async () => {
  const draw = vi.fn<ContentRendererContribution["render"]>(() => html`
    <pre class="renderer-owned-code">Preview code</pre>
    <div class="plain-code-block">Preview text</div>
  `);
  const host = automaticHost(draw);
  host.codeBlocks = { presentation: "code", overflow: "wrap", copy: true };
  document.body.append(host);
  await host.updateComplete;
  const preview = host.renderRoot.querySelector(".preview");
  expect(preview).not.toBeNull();
  const previewCode = preview?.querySelector("pre");
  const previewText = preview?.querySelector(".plain-code-block");

  for (const overflow of ["wrap", "scroll"] as const) {
    host.codeBlocks = { presentation: "code", overflow, copy: true };
    await host.updateComplete;
    expect(host.renderRoot.querySelector(".source-wrap, .source-scroll")).toBeNull();
    expect(host.renderRoot.querySelector(".preview")).toBe(preview);
    expect(preview?.querySelector("pre")).toBe(previewCode);
    expect(preview?.querySelector(".plain-code-block")).toBe(previewText);
    expect(draw).toHaveBeenCalledOnce();
    expect(draw.mock.calls[0]?.[0].signal.aborted).toBe(false);
  }

  button(host, "Raw").click();
  await host.updateComplete;
  expect(host.renderRoot.querySelector("#content > pre.source-scroll")?.textContent).toBe("source");
  expect(host.renderRoot.querySelector(".preview")).toBeNull();
  expect(draw.mock.calls[0]?.[0].signal.aborted).toBe(true);

  host.codeBlocks = { presentation: "plain", overflow: "wrap", copy: true };
  await host.updateComplete;
  expect(host.renderRoot.querySelector("#content > .plain-code-block.source-wrap")?.textContent).toBe("source");
  expect(host.renderRoot.querySelector("#content")?.className).toBe("");
});

describe("content renderer disclosure lifecycle", () => {
  it("retains a closed group's body without starting automatic work, and aborts/restarts only its renderer on toggles", async () => {
    const draw = vi.fn<ContentRendererContribution["render"]>(() => html`<b>Preview</b>`);
    const host = automaticHost(draw);
    const group = document.createElement("details");
    const body = document.createElement("div");
    body.append(host);
    group.append(document.createElement("summary"), body);
    document.body.append(group);
    await host.updateComplete;

    expect(draw).not.toHaveBeenCalled();
    expect(host.isConnected).toBe(true);
    expect(host.renderRoot.querySelector("pre")?.textContent).toBe("source");

    setDetailsOpen(group, true);
    await host.updateComplete;
    expect(draw).toHaveBeenCalledOnce();
    const first = draw.mock.calls[0]?.[0];
    expect(first?.signal.aborted).toBe(false);
    expect(host.renderRoot.querySelector("b")?.textContent).toBe("Preview");

    setDetailsOpen(group, false);
    await host.updateComplete;
    expect(first?.signal.aborted).toBe(true);
    expect(group.lastElementChild).toBe(body);
    expect(body.firstElementChild).toBe(host);
    expect(host.isConnected).toBe(true);
    expect(draw).toHaveBeenCalledOnce();

    setDetailsOpen(group, true);
    await host.updateComplete;
    expect(draw).toHaveBeenCalledTimes(2);
    expect(body.firstElementChild).toBe(host);
    expect(draw.mock.calls[1]?.[0].signal.aborted).toBe(false);
    expect(draw.mock.calls[1]?.[0].signal).not.toBe(first?.signal);
    first?.fail(new Error("obsolete closed preview"));
    await host.updateComplete;
    expect(host.renderRoot.querySelector("b")?.textContent).toBe("Preview");
    expect(host.renderRoot.textContent).not.toContain("Preview failed");
  });

  it("preserves the chooser and manual activation across temporary closure without intent memory", async () => {
    const first = vi.fn<ContentRendererContribution["render"]>(() => html`<b>First</b>`);
    const second = vi.fn<ContentRendererContribution["render"]>(() => html`<b>Second</b>`);
    const host = hostWith([
      { id: "first", label: "First", renderer: { id: "first", renderMode: "manual", render: first } },
      { id: "second", label: "Second", renderer: { id: "second", renderMode: "manual", render: second } },
    ]);
    const group = document.createElement("details");
    group.open = true;
    group.append(document.createElement("summary"), host);
    document.body.append(group);
    await host.updateComplete;
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    const chooser = host.renderRoot.querySelector("select");
    if (chooser === null) throw new Error("Expected renderer chooser");
    chooser.value = "second";
    chooser.dispatchEvent(new Event("change"));
    await host.updateComplete;
    expect(chooser.closest(".code-block-header")).not.toBeNull();
    expect(chooser.selectedOptions[0]?.textContent).toBe("Second");
    button(host, "Render").click();
    await host.updateComplete;
    expect(second).toHaveBeenCalledOnce();

    setDetailsOpen(group, false);
    await host.updateComplete;
    expect(second.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(second).toHaveBeenCalledOnce();
    expect(chooser.value).toBe("second");

    setDetailsOpen(group, true);
    await host.updateComplete;
    expect(group.querySelector("pi-web-content-renderer")).toBe(host);
    expect(host.renderRoot.querySelector("select")).toBe(chooser);
    expect(chooser.value).toBe("second");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(2);
    expect(host.renderRoot.querySelector("b")?.textContent).toBe("Second");

    button(host, "Raw").click();
    await host.updateComplete;
    setDetailsOpen(group, false);
    await host.updateComplete;
    setDetailsOpen(group, true);
    await host.updateComplete;
    expect(second).toHaveBeenCalledTimes(2);
    expect(host.renderRoot.querySelector("pre")?.textContent).toBe("source");
    expect(chooser.value).toBe("second");
  });

  it("requires every nested details ancestor to be open, including outside a shadow host", async () => {
    const draw = vi.fn<ContentRendererContribution["render"]>(() => html`<b>Preview</b>`);
    const host = automaticHost(draw);
    const outer = document.createElement("details");
    const bridge = document.createElement("div");
    const shadow = bridge.attachShadow({ mode: "open" });
    const inner = document.createElement("details");
    inner.open = true;
    inner.append(document.createElement("summary"), host);
    shadow.append(inner);
    outer.append(document.createElement("summary"), bridge);
    document.body.append(outer);
    await host.updateComplete;
    expect(draw).not.toHaveBeenCalled();

    setDetailsOpen(inner, false);
    await host.updateComplete;
    setDetailsOpen(outer, true);
    await host.updateComplete;
    expect(draw).not.toHaveBeenCalled();
    setDetailsOpen(inner, true);
    await host.updateComplete;
    expect(draw).toHaveBeenCalledOnce();

    setDetailsOpen(outer, false);
    await host.updateComplete;
    expect(draw.mock.calls[0]?.[0].signal.aborted).toBe(true);
    setDetailsOpen(inner, false);
    await host.updateComplete;
    setDetailsOpen(inner, true);
    await host.updateComplete;
    expect(draw).toHaveBeenCalledOnce();
    setDetailsOpen(outer, true);
    await host.updateComplete;
    expect(draw).toHaveBeenCalledTimes(2);
    setDetailsOpen(inner, false);
    await host.updateComplete;
    expect(draw.mock.calls[1]?.[0].signal.aborted).toBe(true);
  });

  it("cancels on detach, removes old listeners, and collects new ancestors on reconnect", async () => {
    const draw = vi.fn<ContentRendererContribution["render"]>(() => html`<b>Preview</b>`);
    const host = automaticHost(draw);
    const oldGroup = document.createElement("details");
    oldGroup.open = true;
    oldGroup.append(document.createElement("summary"), host);
    document.body.append(oldGroup);
    await host.updateComplete;
    expect(draw).toHaveBeenCalledOnce();

    host.remove();
    expect(draw.mock.calls[0]?.[0].signal.aborted).toBe(true);
    const requestUpdate = vi.spyOn(host, "requestUpdate");
    setDetailsOpen(oldGroup, false);
    expect(requestUpdate).not.toHaveBeenCalled();

    const newGroup = document.createElement("details");
    newGroup.append(document.createElement("summary"), host);
    document.body.append(newGroup);
    await host.updateComplete;
    expect(draw).toHaveBeenCalledOnce();
    requestUpdate.mockClear();
    setDetailsOpen(oldGroup, true);
    expect(requestUpdate).not.toHaveBeenCalled();
    setDetailsOpen(newGroup, true);
    expect(requestUpdate).toHaveBeenCalledOnce();
    await host.updateComplete;
    expect(draw).toHaveBeenCalledTimes(2);
    expect(draw.mock.calls[1]?.[0].signal.aborted).toBe(false);
  });
});
