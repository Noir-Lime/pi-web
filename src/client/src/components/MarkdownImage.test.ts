// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownImage } from "./MarkdownImage";
import { imageButton, nativeImage, settleImage } from "./imagePresentation.testSupport";

const previewUrl = "https://example.test/nested/api/preview?path=private&showImage=1";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
});

async function mountOutside(intentKey?: string, source = previewUrl) {
  const image = new MarkdownImage();
  image.outside = true;
  image.intentKey = intentKey;
  image.path = "/private/example.png";
  image.description = "Private screenshot";
  image.previewUrl = source;
  document.body.append(image);
  const presentation = await settleImage(image);
  return { image, presentation, native: nativeImage(presentation) };
}

it("assigns workspace sources immediately and lets the browser load them lazily", async () => {
  const image = new MarkdownImage();
  image.path = "screenshots/example.png";
  image.description = "Example screenshot";
  image.previewUrl = "https://example.test/nested/api/preview?path=screenshot.png";
  document.body.append(image);
  const presentation = await settleImage(image);
  const native = nativeImage(presentation);
  expect(native.src).toBe(image.previewUrl);
  expect(native.alt).toBe("Example screenshot");
  expect(native.getAttribute("loading")).toBe("lazy");
  expect(native.getAttribute("decoding")).toBe("async");
  expect(imageButton(presentation, ".placeholder").hidden).toBe(true);
  expect(imageButton(presentation).hidden).toBe(false);
  image.previewUrl = "";
  await settleImage(image);
  expect(nativeImage(presentation)).toBe(native);
  expect(native.hasAttribute("src")).toBe(false);
});

it("keeps outside images src-free until explicit approval, including after source changes", async () => {
  const { image, presentation, native } = await mountOutside();
  const show = imageButton(presentation, ".placeholder");
  expect(native.hasAttribute("src")).toBe(false);
  expect(show.hidden).toBe(false);
  expect(show.textContent).toContain("Show image");
  expect(show.textContent).toContain("/private/example.png");
  expect(imageButton(presentation).hidden).toBe(true);
  show.click();
  await settleImage(image);
  expect(nativeImage(presentation)).toBe(native);
  expect(native.src).toBe(previewUrl);
  expect(show.hidden).toBe(true);
  expect(imageButton(presentation).disabled).toBe(false);

  // Native failures do not revoke approval or replace the image with retry UI.
  native.dispatchEvent(new Event("error"));
  await settleImage(image);
  expect(nativeImage(presentation)).toBe(native);
  expect(native.src).toBe(previewUrl);
  expect(imageButton(presentation).hidden).toBe(false);
  expect(presentation.renderRoot.querySelector('[role="status"]')).toBeNull();

  image.previewUrl = "https://example.test/api/preview?path=different&showImage=1";
  await settleImage(image);
  expect(nativeImage(presentation)).toBe(native);
  expect(native.hasAttribute("src")).toBe(false);
  expect(show.hidden).toBe(false);
  // Without an intent key, even the same URL needs consent on a new visit.
  expect((await mountOutside()).native.hasAttribute("src")).toBe(false);
});

it("preserves the native image and approval on benign props updates but not a new intent", async () => {
  const { image, presentation, native } = await mountOutside("native-benign-props");
  imageButton(presentation, ".placeholder").click();
  await settleImage(image);
  image.path = "/private/renamed-label.png";
  image.description = "Updated description";
  await settleImage(image);
  expect(nativeImage(presentation)).toBe(native);
  expect(native.src).toBe(previewUrl);
  expect(native.alt).toBe("Updated description");
  expect(imageButton(presentation).getAttribute("aria-label")).toBe("Enlarge Updated description");

  image.intentKey = "native-new-intent";
  await settleImage(image);
  expect(nativeImage(presentation)).toBe(native);
  expect(native.hasAttribute("src")).toBe(false);
  expect(imageButton(presentation, ".placeholder").hidden).toBe(false);
});

it("remembers approval only for the chosen intent/source pair, never other images", async () => {
  const first = await mountOutside("native-scoped-choice:first");
  const sibling = await mountOutside("native-scoped-choice:second");
  imageButton(first.presentation, ".placeholder").click();
  await settleImage(first.image);
  expect(first.native.src).toBe(previewUrl);
  expect(sibling.native.hasAttribute("src")).toBe(false);
  first.image.remove();
  const returned = await mountOutside("native-scoped-choice:first");
  expect(returned.native.src).toBe(previewUrl);
  expect(imageButton(returned.presentation, ".placeholder").hidden).toBe(true);
  expect((await mountOutside("native-scoped-choice:other-message")).native.hasAttribute("src")).toBe(false);

  const changed = await mountOutside("native-scoped-choice:first", "https://example.test/different.png");
  expect(changed.native.hasAttribute("src")).toBe(false);
  expect((await mountOutside("native-scoped-choice:first")).native.hasAttribute("src")).toBe(false);
  expect(localStorage.length).toBe(0);
});

it("expires remembered consent after 15 minutes without extending it on revisit", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const first = await mountOutside("native-expiring-choice");
  imageButton(first.presentation, ".placeholder").click();
  await settleImage(first.image);
  vi.setSystemTime(14 * 60_000);
  expect((await mountOutside("native-expiring-choice")).native.src).toBe(previewUrl);
  vi.setSystemTime(15 * 60_000);
  const expired = await mountOutside("native-expiring-choice");
  expect(expired.native.hasAttribute("src")).toBe(false);
  expect(imageButton(expired.presentation, ".placeholder").hidden).toBe(false);
});

it("disables sources without granting outside approval through the inactive request button", async () => {
  const { image, presentation, native } = await mountOutside("disabled-approval-test");
  image.loadingDisabled = true; await settleImage(image);
  const show = imageButton(presentation, ".placeholder");
  expect(show.disabled).toBe(true);
  show.click(); await settleImage(image);
  image.loadingDisabled = false; await settleImage(image);
  expect(show.disabled).toBe(false);
  expect(native.hasAttribute("src")).toBe(false);
  show.click(); await settleImage(image);
  expect(native.src).toBe(previewUrl);
  image.loadingDisabled = true; await settleImage(image);
  expect(native.hasAttribute("src")).toBe(false);
  image.loadingDisabled = false; await settleImage(image);
  expect(native.src).toBe(previewUrl);
});

it("does not carry automatic workspace loading into an outside-file approval", async () => {
  const { image, presentation, native } = await mountOutside("native-boundary-choice");
  image.outside = false;
  await settleImage(image);
  expect(native.src).toBe(previewUrl);
  image.outside = true;
  await settleImage(image);
  expect(nativeImage(presentation)).toBe(native);
  expect(native.hasAttribute("src")).toBe(false);
  expect(imageButton(presentation, ".placeholder").hidden).toBe(false);
});
