// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PromptEditor } from "./PromptEditor";

beforeEach(() => {
  // CodeMirror measurement is a browser concern; keep this test on the control's native interaction.
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["disabled", "sending"] as const)("opens the file picker and respects the composer's %s state", async (busyProperty) => {
  const editor = new PromptEditor();
  document.body.append(editor);
  await editor.updateComplete;
  const button = editor.renderRoot.querySelector<HTMLButtonElement>('button[aria-label="Attach files"]');
  const input = editor.renderRoot.querySelector<HTMLInputElement>('input[type="file"]');
  if (button === null || input === null) throw new Error("Expected attachment controls");
  const open = vi.spyOn(input, "click").mockImplementation(() => undefined);
  expect(button.type).toBe("button");
  expect(input.multiple).toBe(true);
  button.focus();
  expect(editor.shadowRoot?.activeElement).toBe(button);
  button.click();
  expect(open).toHaveBeenCalledOnce();

  editor[busyProperty] = true;
  await editor.updateComplete;
  expect(button.disabled).toBe(true);
  button.click();
  expect(open).toHaveBeenCalledOnce();
});
