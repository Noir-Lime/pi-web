export interface ChatScrollViewport {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  getBoundingClientRect(): Pick<DOMRectReadOnly, "top" | "bottom">;
}

export interface ChatScrollElement {
  getBoundingClientRect(): Pick<DOMRectReadOnly, "top" | "bottom">;
}

const DEFAULT_NEAR_BOTTOM_THRESHOLD = 48;

export function distanceFromScrollBottom(scroller: Pick<ChatScrollViewport, "scrollHeight" | "scrollTop" | "clientHeight">): number {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
}

export function isNearScrollBottom(scroller: Pick<ChatScrollViewport, "scrollHeight" | "scrollTop" | "clientHeight">, threshold = DEFAULT_NEAR_BOTTOM_THRESHOLD): boolean {
  return distanceFromScrollBottom(scroller) < threshold;
}

export function findFirstVisibleArticle<T extends ChatScrollElement>(scroller: ChatScrollViewport, articles: T[]): T | undefined {
  const scrollerRect = scroller.getBoundingClientRect();
  return articles.find((article) => {
    const rect = article.getBoundingClientRect();
    return rect.bottom >= scrollerRect.top && rect.top <= scrollerRect.bottom;
  });
}
