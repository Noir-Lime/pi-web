// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { AutocompleteMenu } from "./AutocompleteMenu";

afterEach(() => {
  document.body.replaceChildren();
});

describe("AutocompleteMenu", () => {
  it("renders the argument hint next to the command name, before the description", async () => {
    const menu = new AutocompleteMenu();
    menu.items = [{ kind: "command", replaceFrom: 0, replaceTo: 1, insertText: "/pr", detail: "prompt", description: "Review PRs from URLs", argumentHint: "<PR-URL>" }];
    document.body.append(menu);
    await menu.updateComplete;

    const label = menu.shadowRoot?.querySelector(".label");
    expect(label?.textContent).toContain("/pr");
    expect(label?.querySelector(".argument-hint")?.textContent).toBe("<PR-URL>");
    expect(menu.shadowRoot?.querySelector(".detail")?.textContent).toBe("prompt");
    expect(menu.shadowRoot?.querySelector("small")?.textContent).toBe("Review PRs from URLs");
  });

  it("omits the hint element for items without an argument hint", async () => {
    const menu = new AutocompleteMenu();
    menu.items = [{ kind: "file", replaceFrom: 0, replaceTo: 1, insertText: "@src/index.ts", detail: "tracked" }];
    document.body.append(menu);
    await menu.updateComplete;

    expect(menu.shadowRoot?.querySelector(".argument-hint")).toBeNull();
    expect(menu.shadowRoot?.querySelector(".label strong")?.textContent).toBe("@src/index.ts");
  });
});
