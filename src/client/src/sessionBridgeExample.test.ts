// @vitest-environment happy-dom
import { html, render, svg } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import plugin from "../../../examples/session-bridge-plugin/src/browser/index.js";
import type { WorkspacePanelContext } from "../../plugin-api.js";

afterEach(() => { document.body.replaceChildren(); });

it("routes explicit existing/new choices through each selected panel peer and displays scoped receipts/errors", async () => {
  const activation = await plugin.activate({
    apiVersion: 4, pluginId: "example", runtimePluginId: "example", html, svg,
    signal: new AbortController().signal, lifetimeSignal: new AbortController().signal,
  });
  const panel = activation.contributions.workspacePanels?.[0];
  if (!panel) throw new Error("Example panel missing");
  const unused = () => { throw new Error("Unrelated host API must not be called"); };
  const first = vi.fn(() => Promise.resolve({ sessionId: "existing", message: "Received" }));
  const second = vi.fn(() => Promise.reject(new Error("Backend unavailable")));
  let context: WorkspacePanelContext = {
    machine: { id: "remote-a", name: "A", kind: "remote" },
    workspace: { id: "workspace", projectId: "project", path: "/workspace", label: "Workspace", isMain: true },
    state: { selectedSession: { id: "existing" } },
    files: { readFile: unused, listFiles: unused, writeFile: unused, deleteFile: unused, moveFile: unused },
    prompt: { insertText: unused, getText: unused, getSelection: unused },
    terminal: { open: unused, runCommand: unused },
    peer: { request: first },
    host: { requestRender: () => { render(panel.render(context), document.body); } },
  };
  context.host.requestRender();
  const button = (index: number) => {
    const element = document.querySelectorAll("button")[index];
    if (!element) throw new Error("Example button missing");
    return element;
  };
  button(1).click();
  await vi.waitFor(() => { expect(document.body.textContent).toContain("existing: Received"); });
  expect(first).toHaveBeenCalledWith("existing", "existing");

  context = { ...context, machine: { id: "remote-b", name: "B", kind: "remote" }, state: {}, peer: { request: second } };
  context.host.requestRender();
  expect(document.body.textContent).not.toContain("existing: Received");
  expect(button(1).disabled).toBe(true);
  button(0).click();
  await vi.waitFor(() => { expect(document.body.textContent).toContain("Backend unavailable"); });
  expect(second).toHaveBeenCalledWith("create", null);
  expect(first).toHaveBeenCalledOnce();
  await activation.dispose?.(new AbortController().signal);
});
