// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { canSaveMessageEdit, MessageEditDialog } from "./MessageEditDialog";

afterEach(() => {
  document.body.replaceChildren();
});

async function mount(props: Partial<Pick<MessageEditDialog, "initialText" | "onSave" | "onCancel">> = {}): Promise<MessageEditDialog> {
  const dialog = new MessageEditDialog();
  Object.assign(dialog, { initialText: "Original\nline two", onSave: vi.fn(() => Promise.resolve()), onCancel: vi.fn(), ...props });
  document.body.append(dialog);
  await dialog.updateComplete;
  return dialog;
}

function field(dialog: MessageEditDialog): HTMLTextAreaElement {
  const textarea = dialog.shadowRoot?.querySelector("textarea");
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("Missing textarea");
  return textarea;
}

function button(dialog: MessageEditDialog, label: string): HTMLButtonElement {
  const found = [...dialog.shadowRoot?.querySelectorAll("button") ?? []].find((item) => item.textContent.trim() === label);
  if (found === undefined) throw new Error(`Missing button ${label}`);
  return found;
}

async function type(dialog: MessageEditDialog, value: string): Promise<void> {
  const textarea = field(dialog);
  textarea.value = value;
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
  await dialog.updateComplete;
}

describe("canSaveMessageEdit", () => {
  it("requires a changed, non-blank draft", () => {
    expect(canSaveMessageEdit("a", "a")).toBe(false);
    expect(canSaveMessageEdit("a", "  ")).toBe(false);
    expect(canSaveMessageEdit("a", "b")).toBe(true);
    expect(canSaveMessageEdit("a", "a ")).toBe(true);
  });
});

describe("MessageEditDialog", () => {
  it("shows the original multiline text and explains that replies stay", async () => {
    const dialog = await mount();
    expect(field(dialog).value).toBe("Original\nline two");
    expect(dialog.shadowRoot?.textContent).toContain("Later replies stay as they are, and no new response is generated.");
    expect(button(dialog, "Save changes").disabled).toBe(true);
  });

  it("saves the exact draft text without trimming", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    const dialog = await mount({ onSave });
    await type(dialog, "  New\n\ntext  \n");
    button(dialog, "Save changes").click();
    await dialog.updateComplete;
    expect(onSave).toHaveBeenCalledExactlyOnceWith("  New\n\ntext  \n");
  });

  it("keeps the draft, shows the error and allows retry when saving fails", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("Message changed")).mockResolvedValueOnce(undefined);
    const dialog = await mount({ onSave });
    await type(dialog, "Edited");
    button(dialog, "Save changes").click();
    await vi.waitFor(() => { expect(dialog.shadowRoot?.querySelector("[role=alert]")?.textContent).toBe("Message changed"); });
    expect(field(dialog).value).toBe("Edited");
    expect(button(dialog, "Save changes").disabled).toBe(false);
    button(dialog, "Save changes").click();
    await vi.waitFor(() => { expect(onSave).toHaveBeenCalledTimes(2); });
    expect(onSave).toHaveBeenLastCalledWith("Edited");
  });

  it("ignores cancel and a second save while saving", async () => {
    let finish: () => void = () => undefined;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onCancel = vi.fn();
    const dialog = await mount({ onSave, onCancel });
    await type(dialog, "Edited");
    button(dialog, "Save changes").click();
    await dialog.updateComplete;
    expect(button(dialog, "Saving…").disabled).toBe(true);
    expect(button(dialog, "Cancel").disabled).toBe(true);
    button(dialog, "Cancel").click();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledOnce();
    finish();
    await dialog.updateComplete;
  });

  it("cancels without saving", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    const onCancel = vi.fn();
    const dialog = await mount({ onSave, onCancel });
    button(dialog, "Cancel").click();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});
