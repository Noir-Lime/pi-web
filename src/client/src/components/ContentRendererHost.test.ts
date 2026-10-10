// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { html } from "lit";
import type { ContentRendererContribution } from "../../../plugin-api";
import type { ContentRendererChoice } from "../plugins/contentRenderers";
import { ContentRendererHost } from "./ContentRendererHost";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
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
  const found = [...host.renderRoot.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
  if (found === undefined) throw new Error(`Missing ${label} button`);
  return found;
}

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
