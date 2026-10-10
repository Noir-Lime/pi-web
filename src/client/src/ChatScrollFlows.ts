import type { ChatBehaviors } from "./chatBehaviors";
import { ChatScrollController, isNearScrollBottom, type ChatScrollPosition, type ChatScrollScheduler, type ChatScrollStorage } from "./chatScrollPosition";

export interface ChatScrollFlowsHost {
  getScroller(): HTMLDivElement | undefined;
  getAnchors(): HTMLElement[];
  getSessionId(): string;
  getBehaviors(): ChatBehaviors;
  hasMore(): boolean;
  isHistoryReady(): boolean;
  isLoadingMore(): boolean;
  requestEarlier(): void;
  canRequestEarlier(): boolean;
  getOpenForm(kind?: "ask" | "dialog"): HTMLElement | undefined;
}

export interface ChatScrollFrameScheduler {
  request(callback: () => void): number;
  cancel(id: number): void;
}

export interface ChatScrollPositionOptions {
  storage?: ChatScrollStorage;
  saveScheduler?: ChatScrollScheduler;
}

export interface ChatScrollBeforeRender {
  sessionChanged: boolean;
  previousSessionId?: unknown;
  prepend: boolean;
}

export interface ChatScrollAfterRender {
  sessionChanged: boolean;
  contentChanged: boolean;
  historyChanged: boolean;
  openedForm: boolean | "ask" | "dialog";
}

const browserFrames: ChatScrollFrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => { cancelAnimationFrame(id); },
};

function canLoadEarlier(host: ChatScrollFlowsHost): boolean {
  return host.hasMore() && !host.isLoadingMore() && host.canRequestEarlier();
}

class TailFlow {
  pinned = true;
  private lastTop: number | undefined;
  private frame: number | undefined;
  private alignForm: boolean | "ask" | "dialog" = false;
  private enabled: boolean;

  constructor(private readonly host: ChatScrollFlowsHost, private readonly frames: ChatScrollFrameScheduler) {
    this.enabled = host.getBehaviors().followTail;
  }

  configure(): void {
    const enabled = this.host.getBehaviors().followTail;
    if (!enabled) this.cancel();
    else if (!this.enabled) this.refreshPin();
    this.enabled = enabled;
  }

  refreshPin(): void {
    if (!this.host.getBehaviors().followTail) return;
    const scroller = this.host.getScroller();
    if (scroller === undefined) return;
    this.lastTop = scroller.scrollTop;
    this.pinned = isNearScrollBottom(scroller);
  }

  onScroll(): void {
    if (!this.host.getBehaviors().followTail) return;
    const scroller = this.host.getScroller();
    if (scroller === undefined) return;
    const upward = this.lastTop !== undefined && scroller.scrollTop < this.lastTop;
    this.lastTop = scroller.scrollTop;
    this.pinned = !upward && isNearScrollBottom(scroller);
    if (!this.pinned) this.cancel();
  }

  pause(): void {
    this.pinned = false;
    this.cancel();
  }

  startup(): void {
    if (!this.host.getBehaviors().followTail) return;
    this.refreshPin();
    this.pinned = true;
    this.schedule(true);
  }

  schedule(alignForm: boolean | "ask" | "dialog" = false): void {
    if (!this.host.getBehaviors().followTail || !this.pinned) return;
    if (alignForm !== false) this.alignForm = alignForm;
    if (this.frame !== undefined) return;
    this.frame = this.frames.request(() => {
      this.frame = undefined;
      const alignForm = this.alignForm;
      this.alignForm = false;
      if (!this.host.getBehaviors().followTail || !this.pinned) return;
      const scroller = this.host.getScroller();
      if (scroller === undefined) return;
      const form = alignForm === false ? undefined : this.host.getOpenForm(typeof alignForm === "string" ? alignForm : undefined);
      if (form === undefined) scroller.scrollTop = scroller.scrollHeight;
      else scroller.scrollTop += form.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      this.refreshPin();
    });
  }

  cancel(): void {
    if (this.frame !== undefined) this.frames.cancel(this.frame);
    this.frame = undefined;
    this.alignForm = false;
  }

  reset(): void {
    this.cancel();
    this.lastTop = undefined;
    this.pinned = true;
  }
}

class PositionFlow {
  private frame: number | undefined;
  private pending: { sessionId: string; position: ChatScrollPosition } | undefined;
  private requestedHistory = false;

  constructor(
    private readonly host: ChatScrollFlowsHost,
    private readonly frames: ChatScrollFrameScheduler,
    private readonly controller: ChatScrollController,
    private readonly onRestored: () => void,
    private readonly onMissing: () => void,
  ) {}

  get restoring(): boolean {
    return this.pending !== undefined;
  }

  save(sessionId = this.host.getSessionId()): void {
    // Do not replace a selected, not-yet-loaded anchor with an incidental scroll position.
    if (!this.host.getBehaviors().rememberPosition || sessionId === "" || this.pending?.sessionId === sessionId) return;
    this.controller.savePosition(sessionId, this.host.getScroller(), this.host.getAnchors());
  }

  scheduleSave(): void {
    if (!this.host.getBehaviors().rememberPosition || this.restoring) return;
    this.controller.scheduleSave(this.host.getSessionId(), (sessionId) => {
      if (sessionId === this.host.getSessionId()) this.save(sessionId);
    });
  }

  restore(): boolean {
    this.reset();
    if (!this.host.getBehaviors().rememberPosition) return false;
    const sessionId = this.host.getSessionId();
    const position = this.controller.readPosition(sessionId);
    if (position === undefined) return false;
    this.pending = { sessionId, position };
    this.retry(false);
    return true;
  }

  retry(historyChanged: boolean): void {
    if (!this.host.getBehaviors().rememberPosition || this.pending === undefined) return;
    if (historyChanged) this.requestedHistory = false;
    if (this.frame !== undefined) return;
    this.frame = this.frames.request(() => {
      this.frame = undefined;
      const pending = this.pending;
      if (!this.host.getBehaviors().rememberPosition || pending?.sessionId !== this.host.getSessionId()) return;
      const result = this.controller.restoreExplicitPosition(pending.position, this.host.getScroller(), this.host.getAnchors(), { fallbackToBottom: this.host.isHistoryReady() && !this.host.hasMore() });
      if (result.status === "restored" || result.status === "bottom") {
        this.pending = undefined;
        this.onRestored();
      } else if (result.status === "missing") {
        this.onMissing();
        if (this.host.isHistoryReady() && !this.requestedHistory && canLoadEarlier(this.host)) {
          this.requestedHistory = true;
          this.host.requestEarlier();
        }
      }
    });
  }

  reset(): void {
    this.controller.clearScheduledSave();
    if (this.frame !== undefined) this.frames.cancel(this.frame);
    this.frame = undefined;
    this.pending = undefined;
    this.requestedHistory = false;
  }
}

class HistoryFlow {
  private frame: number | undefined;

  constructor(private readonly host: ChatScrollFlowsHost, private readonly frames: ChatScrollFrameScheduler) {}

  schedule(): void {
    if (!this.host.getBehaviors().automaticHistory || this.frame !== undefined || !canLoadEarlier(this.host)) return;
    const scroller = this.host.getScroller();
    if (scroller === undefined || scroller.scrollTop > 64) return;
    this.frame = this.frames.request(() => {
      this.frame = undefined;
      if (!this.host.getBehaviors().automaticHistory || !canLoadEarlier(this.host)) return;
      const scroller = this.host.getScroller();
      if (scroller !== undefined && scroller.scrollTop <= 64) this.host.requestEarlier();
    });
  }

  cancel(): void {
    if (this.frame !== undefined) this.frames.cancel(this.frame);
    this.frame = undefined;
  }
}

class PrependFlow {
  private snapshot: { height: number; top: number } | undefined;
  private frame: number | undefined;

  constructor(private readonly host: ChatScrollFlowsHost, private readonly frames: ChatScrollFrameScheduler, private readonly onCorrected: () => void) {}

  capture(): void {
    if (!this.host.getBehaviors().anchorPrepends) return;
    this.cancel();
    const scroller = this.host.getScroller();
    if (scroller !== undefined) this.snapshot = { height: scroller.scrollHeight, top: scroller.scrollTop };
  }

  apply(): boolean {
    if (!this.host.getBehaviors().anchorPrepends) return false;
    if (this.frame !== undefined) return true;
    const snapshot = this.snapshot;
    if (snapshot === undefined) return false;
    this.snapshot = undefined;
    const scroller = this.host.getScroller();
    if (scroller === undefined) return false;
    const target = snapshot.top + scroller.scrollHeight - snapshot.height;
    this.frame = this.frames.request(() => {
      this.frame = undefined;
      if (!this.host.getBehaviors().anchorPrepends) return;
      const scroller = this.host.getScroller();
      if (scroller?.scrollTop !== snapshot.top) return;
      scroller.scrollTop = target;
      this.onCorrected();
    });
    return true;
  }

  cancel(): void {
    if (this.frame !== undefined) this.frames.cancel(this.frame);
    this.frame = undefined;
    this.snapshot = undefined;
  }
}

/** Plain scroll effects; the parent owns rendering, input adapters, and history's in-flight guard. */
export class ChatScrollFlows {
  private readonly tail: TailFlow;
  private readonly position: PositionFlow;
  private readonly history: HistoryFlow;
  private readonly prepend: PrependFlow;
  private started = false;
  private disposed = false;

  constructor(
    private readonly host: ChatScrollFlowsHost,
    frames: ChatScrollFrameScheduler = browserFrames,
    positionOptions: ChatScrollPositionOptions = {},
  ) {
    this.tail = new TailFlow(host, frames);
    this.position = new PositionFlow(host, frames, new ChatScrollController(positionOptions.storage, positionOptions.saveScheduler), () => { this.tail.refreshPin(); }, () => { this.tail.pause(); });
    this.history = new HistoryFlow(host, frames);
    this.prepend = new PrependFlow(host, frames, () => { this.tail.refreshPin(); });
  }

  get pinnedToBottom(): boolean {
    return this.tail.pinned;
  }

  beforeRender(change: ChatScrollBeforeRender): void {
    if (this.disposed) return;
    if (change.sessionChanged) {
      if (typeof change.previousSessionId === "string") this.position.save(change.previousSessionId);
      this.position.reset();
      this.tail.reset();
      this.history.cancel();
      this.prepend.cancel();
    } else if (change.prepend && !this.position.restoring) {
      this.tail.cancel();
      this.prepend.capture();
    }
  }

  afterRender(change: ChatScrollAfterRender): void {
    if (this.disposed) return;
    if (!this.started || change.sessionChanged) {
      this.started = true;
      this.restorePosition();
    } else if (this.position.restoring) {
      if (change.contentChanged || change.historyChanged) this.position.retry(change.historyChanged);
    } else if (!this.prepend.apply() && (change.contentChanged || change.openedForm !== false)) {
      this.tail.schedule(change.openedForm);
    }
    if (!this.position.restoring) this.history.schedule();
  }

  onScroll(): void {
    if (this.disposed) return;
    this.tail.onScroll();
    this.position.scheduleSave();
    if (!this.position.restoring) this.history.schedule();
  }

  onInteraction(): void {
    // A delayed history-backed restore must not reclaim the user's viewport.
    if (this.disposed) return;
    if (this.position.restoring) this.position.reset();
    this.prepend.cancel();
  }

  onUpIntent(): void {
    this.onInteraction();
    if (!this.disposed && this.host.getBehaviors().followTail) this.tail.pause();
  }

  onViewportResize(): void {
    if (this.disposed) return;
    if (this.position.restoring) this.position.retry(false);
    else {
      this.tail.schedule();
      this.history.schedule();
    }
  }

  configure(): void {
    if (this.disposed) return;
    const behaviors = this.host.getBehaviors();
    this.tail.configure();
    if (!behaviors.rememberPosition) this.position.reset();
    if (!behaviors.automaticHistory) this.history.cancel();
    if (!behaviors.anchorPrepends) this.prepend.cancel();
  }

  savePosition(sessionId?: string): void {
    if (!this.disposed) this.position.save(sessionId);
  }

  restorePosition(): void {
    if (this.disposed) return;
    this.tail.cancel();
    this.prepend.cancel();
    this.history.cancel();
    if (this.position.restore()) this.tail.pause();
    else this.tail.startup();
  }

  jumpToEnd(): void {
    this.jump(true);
  }

  jumpToTop(): void {
    this.jump(false);
  }

  private jump(end: boolean): void {
    if (this.disposed) return;
    this.position.reset();
    this.tail.cancel();
    this.prepend.cancel();
    const scroller = this.host.getScroller();
    if (scroller === undefined) return;
    scroller.scrollTop = end ? scroller.scrollHeight : 0;
    this.tail.pinned = end;
    this.tail.refreshPin();
    this.position.scheduleSave();
  }

  dispose(): void {
    if (this.disposed) return;
    this.position.save();
    this.disposed = true;
    this.position.reset();
    this.tail.cancel();
    this.history.cancel();
    this.prepend.cancel();
  }
}
