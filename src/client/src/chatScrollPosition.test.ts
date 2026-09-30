import { describe, expect, it } from "vitest";
import { findFirstVisibleArticle, type ChatScrollElement, type ChatScrollViewport } from "./chatScrollPosition";

class FakeScroller implements ChatScrollViewport {
  constructor(
    public scrollTop: number,
    public scrollHeight: number,
    public clientHeight: number,
    private readonly top: number,
    private readonly bottom: number,
  ) {}

  getBoundingClientRect(): Pick<DOMRectReadOnly, "top" | "bottom"> {
    return { top: this.top, bottom: this.bottom };
  }
}

class FakeArticle implements ChatScrollElement {
  constructor(
    private readonly top: number,
    private readonly bottom: number,
  ) {}

  getBoundingClientRect(): Pick<DOMRectReadOnly, "top" | "bottom"> {
    return { top: this.top, bottom: this.bottom };
  }
}

describe("chat scroll helpers", () => {
  it("finds the first article intersecting the viewport", () => {
    const scroller = new FakeScroller(0, 1000, 100, 100, 200);
    const first = new FakeArticle(20, 80);
    const second = new FakeArticle(150, 180);

    expect(findFirstVisibleArticle(scroller, [first, second])).toBe(second);
  });
});
