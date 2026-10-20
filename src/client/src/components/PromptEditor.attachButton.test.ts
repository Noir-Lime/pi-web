// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { html } from "lit";
import { PromptEditor } from "./PromptEditor";
import { clearStagedAttachments, saveStagedAttachments } from "../promptAttachmentStaging";

beforeEach(() => {
  // CodeMirror measurement is a browser concern; keep this test on the control's native interaction.
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  clearStagedAttachments("local:appearance-controls");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("renders supplied chat navigation inside the input alongside the attachment control", async () => {
  const editor = new PromptEditor();
  const jump = vi.fn();
  editor.chatNavigation = html`<nav aria-label="Chat navigation"><button @click=${jump}>Jump to end</button></nav>`;
  document.body.append(editor);
  await editor.updateComplete;
  const navigation = editor.renderRoot.querySelector(".editor-chat-navigation");
  const attachment = editor.renderRoot.querySelector(".editor-attach");
  expect(navigation?.parentElement).toBe(attachment?.parentElement);
  const button = navigation?.querySelector("button");
  if (!button) throw new Error("Expected supplied chat navigation");
  button.click();
  expect(jump).toHaveBeenCalledOnce();
});

function stubAttachSourceMedia(matches: boolean): void {
  const media = window.matchMedia("(pointer: coarse)");
  Object.defineProperty(media, "matches", { value: matches });
  vi.spyOn(window, "matchMedia").mockReturnValue(media);
}

it("offers image and camera pickers so touch devices can reach the photo gallery", async () => {
  const editor = new PromptEditor();
  document.body.append(editor);
  await editor.updateComplete;
  const image = editor.renderRoot.querySelector<HTMLInputElement>(".attachment-image-input");
  const camera = editor.renderRoot.querySelector<HTMLInputElement>(".attachment-camera-input");
  // The image accept hint is the contract: Android only offers the photo
  // gallery for inputs that accept images.
  expect(image?.accept).toBe("image/*");
  expect(camera?.getAttribute("capture")).toBe("environment");
  expect(image?.multiple).toBe(true);
  expect(camera?.multiple).toBe(true);
});

it("opens the file dialog directly on pointer devices", async () => {
  stubAttachSourceMedia(false);
  const editor = new PromptEditor();
  document.body.append(editor);
  await editor.updateComplete;
  const attach = editor.renderRoot.querySelector<HTMLButtonElement>(".editor-attach");
  const direct = editor.renderRoot.querySelector<HTMLInputElement>(".attachment-input");
  const panel = editor.renderRoot.querySelector<HTMLDivElement>(".attach-source-panel");
  if (!attach || !direct || !panel) throw new Error("Expected attachment controls");
  const showPopover = vi.fn();
  Object.defineProperty(panel, "showPopover", { value: showPopover, configurable: true });
  const openDirect = vi.spyOn(direct, "click");
  attach.click();
  expect(openDirect).toHaveBeenCalledOnce();
  expect(showPopover).not.toHaveBeenCalled();
  expect(attach.getAttribute("aria-expanded")).toBe("false");
});

it("opens the source menu on touch devices and wires each item to its picker", async () => {
  stubAttachSourceMedia(true);
  const editor = new PromptEditor();
  document.body.append(editor);
  await editor.updateComplete;
  const attach = editor.renderRoot.querySelector<HTMLButtonElement>(".editor-attach");
  const panel = editor.renderRoot.querySelector<HTMLDivElement>(".attach-source-panel");
  if (!attach || !panel) throw new Error("Expected attachment source menu");
  const shown = vi.fn();
  const hidden = vi.fn();
  Object.defineProperty(panel, "showPopover", { value: shown, configurable: true });
  Object.defineProperty(panel, "hidePopover", { value: hidden, configurable: true });
  attach.click();
  expect(shown).toHaveBeenCalledOnce();
  // happy-dom does not implement native popover activation/dismissal. Model only
  // its toggle notification; native light-dismiss and placement need a browser.
  panel.dispatchEvent(Object.assign(new Event("toggle"), { newState: "open" }));
  await editor.updateComplete;
  expect(attach.getAttribute("aria-expanded")).toBe("true");
  const items = [...panel.querySelectorAll<HTMLButtonElement>(".ui-menu-item")];
  expect(items.length).toBe(3);
  expect(items.map((item) => item.textContent.trim())).toEqual(["Photos", "Camera", "Files"]);
  const [photosItem, cameraItem, filesItem] = items;
  if (!photosItem || !cameraItem || !filesItem) throw new Error("Expected three attachment source items");
  const pickImage = editor.renderRoot.querySelector<HTMLInputElement>(".attachment-image-input");
  const pickCamera = editor.renderRoot.querySelector<HTMLInputElement>(".attachment-camera-input");
  const pickFiles = editor.renderRoot.querySelector<HTMLInputElement>(".attachment-input");
  if (!pickImage || !pickCamera || !pickFiles) throw new Error("Expected attachment picker inputs");
  const pickImageClick = vi.spyOn(pickImage, "click");
  const pickCameraClick = vi.spyOn(pickCamera, "click");
  const pickFilesClick = vi.spyOn(pickFiles, "click");
  photosItem.click();
  expect(hidden).toHaveBeenCalledOnce();
  expect(pickImageClick).toHaveBeenCalledOnce();
  cameraItem.click();
  expect(pickCameraClick).toHaveBeenCalledOnce();
  filesItem.click();
  expect(pickFilesClick).toHaveBeenCalledOnce();
  // Simulate the native dismissal notification after a pick.
  panel.dispatchEvent(Object.assign(new Event("toggle"), { newState: "closed" }));
  await editor.updateComplete;
  expect(attach.getAttribute("aria-expanded")).toBe("false");
});

it("keeps attachment delivery and removal wired through native shared controls", async () => {
  const key = "local:appearance-controls";
  saveStagedAttachments(key, [{ id: "image-1", kind: "image", name: "screenshot.png", mimeType: "image/png", data: "QUJD", size: 3 }]);
  const editor = new PromptEditor();
  editor.sessionId = "appearance-controls";
  document.body.append(editor);
  await editor.updateComplete;
  const delivery = editor.renderRoot.querySelector<HTMLSelectElement>('select[aria-label="Attachment delivery"]');
  const remove = editor.renderRoot.querySelector<HTMLButtonElement>('button[aria-label="Remove screenshot.png"]');
  if (delivery === null || remove === null) throw new Error("Expected pending attachment controls");
  expect(delivery.classList.contains("ui-select")).toBe(true);
  expect(remove.classList.contains("ui-button--icon")).toBe(true);
  expect(remove.type).toBe("button");
  delivery.value = "folder";
  delivery.dispatchEvent(new Event("change", { bubbles: true }));
  await editor.updateComplete;
  expect(delivery.value).toBe("folder");
  expect(localStorage.getItem("pi-web:attachment-delivery")).toBe("folder");
  remove.focus();
  expect(editor.shadowRoot?.activeElement).toBe(remove);
  remove.click();
  await editor.updateComplete;
  expect(editor.renderRoot.querySelector(".attachment-chip")).toBeNull();
});

it("removes plugin context by identity and retains the disabled contract", async () => {
  const editor = new PromptEditor();
  const chip = { id: "context", key: "context-key", pluginId: "test", target: { machineId: "local", sessionId: "appearance-controls" }, label: "Context", text: "Context content" };
  editor.promptChips = [chip];
  editor.onRemoveChip = vi.fn();
  document.body.append(editor);
  await editor.updateComplete;
  const remove = editor.renderRoot.querySelector<HTMLButtonElement>('button[aria-label="Remove Context"]');
  if (remove === null) throw new Error("Expected context removal control");
  expect(remove.classList.contains("ui-button--icon")).toBe(true);
  remove.click();
  expect(editor.onRemoveChip).toHaveBeenCalledWith(chip);
  editor.disabled = true;
  await editor.updateComplete;
  expect(remove.disabled).toBe(true);
  remove.click();
  expect(editor.onRemoveChip).toHaveBeenCalledOnce();
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
