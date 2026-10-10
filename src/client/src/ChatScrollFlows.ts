import type { ChatBehaviors } from "./chatBehaviors";
import { ChatScrollController, type ChatScrollPosition, type ChatScrollScheduler, type ChatScrollStorage } from "./chatScrollPosition";

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
  onFollowingChange?(following: boolean): void;
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

const BOTTOM_TOLERANCE_PX = 2;

interface TailScrollPosition {
  top: number;
  maxTop: number;
  overscrollBottom: number | undefined;
}

class TailFlow {
  private following = false;
  private lastPosition: TailScrollPosition | undefined;
  private frame: number | undefined;
  private alignForm: boolean | "ask" | "dialog" = false;
  private enabled: boolean;

  constructor(private readonly host: ChatScrollFlowsHost, private readonly frames: ChatScrollFrameScheduler) {
    this.enabled = host.getBehaviors().followTail;
  }

  get followingLive(): boolean {
    return this.following;
  }

  configure(): void {
    const enabled = this.host.getBehaviors().followTail;
    if (!enabled) this.pause();
    else if (!this.enabled) this.syncFollowingAfterNavigation();
    this.enabled = enabled;
  }

  /** Navigation and capability changes may choose a mode; ordinary layout changes may not. */
  syncFollowingAfterNavigation(): void {
    if (!this.host.getBehaviors().followTail) return;
    const position = this.readPosition();
    if (position === undefined) return;
    this.lastPosition = position;
    this.setFollowing(position.maxTop - position.top < BOTTOM_TOLERANCE_PX);
  }

  recordScrollBaseline(): void {
    if (this.host.getBehaviors().followTail) this.lastPosition = this.readPosition();
  }

  onScroll(): void {
    if (!this.host.getBehaviors().followTail) return;
    const position = this.readPosition({ preserveOverscroll: true });
    if (position === undefined) return;
    const previous = this.lastPosition;
    this.lastPosition = position;
    if (previous?.maxTop !== position.maxTop) return;
    const atBottom = position.maxTop - position.top < BOTTOM_TOLERANCE_PX;
    const returnedToBottom = position.top > previous.top && atBottom;
    const isBottomRebound = position.overscrollBottom !== undefined || previous.overscrollBottom !== undefined;
    const readingUpward = position.top < previous.top && !atBottom && !isBottomRebound;
    // A stationary event after content growth is not a decision to read history.
    // A rebound stays browser-owned even if streaming moved the bottom meanwhile.
    if (returnedToBottom) this.setFollowing(true);
    else if (readingUpward) this.pause();
  }

  pause(): void {
    this.setFollowing(false);
    this.cancel();
  }

  startFollowing(): void {
    this.setFollowing(true);
    this.recordScrollBaseline();
  }

  startup(): void {
    if (!this.host.getBehaviors().followTail) return;
    this.startFollowing();
    this.schedule(true);
  }

  private readPosition(options: { preserveOverscroll?: boolean } = {}): TailScrollPosition | undefined {
    const scroller = this.host.getScroller();
    if (scroller === undefined) return undefined;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const rawTop = scroller.scrollTop;
    // Safari can report scrollTop beyond either end during native rubber-banding.
    // Retain the original bottom through rebound when content grows mid-gesture;
    // an explicit navigation/follow write starts a fresh position sample instead.
    const overscrollBottom = (options.preserveOverscroll === true ? this.lastPosition?.overscrollBottom : undefined)
      ?? (rawTop > maxTop ? maxTop : undefined);
    return {
      top: Math.max(0, Math.min(rawTop, maxTop)),
      maxTop,
      overscrollBottom: overscrollBottom !== undefined && rawTop >= overscrollBottom ? overscrollBottom : undefined,
    };
  }

  private setFollowing(following: boolean): void {
    following = following && this.host.getBehaviors().followTail;
    if (this.following === following) return;
    this.following = following;
    this.host.onFollowingChange?.(following);
  }

  schedule(alignForm: boolean | "ask" | "dialog" = false): void {
    if (!this.host.getBehaviors().followTail) return;
    // Establish the rendered/resized range before native input can precede the RAF.
    this.lastPosition = this.readPosition({ preserveOverscroll: true });
    if (!this.following) return;
    if (alignForm !== false) this.alignForm = alignForm;
    if (this.frame !== undefined) return;
    this.frame = this.frames.request(() => {
      this.frame = undefined;
      const alignForm = this.alignForm;
      this.alignForm = false;
      if (!this.host.getBehaviors().followTail || !this.following) return;
      const scroller = this.host.getScroller();
      if (scroller === undefined) return;
      const form = alignForm === false ? undefined : this.host.getOpenForm(typeof alignForm === "string" ? alignForm : undefined);
      if (form === undefined) scroller.scrollTop = scroller.scrollHeight;
      else scroller.scrollTop += form.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      if (form === undefined) this.recordScrollBaseline();
      else this.syncFollowingAfterNavigation();
    });
  }

  cancel(): void {
    if (this.frame !== undefined) this.frames.cancel(this.frame);
    this.frame = undefined;
    this.alignForm = false;
  }

  reset(): void {
    this.cancel();
    this.lastPosition = undefined;
    this.setFollowing(false);
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
    this.position = new PositionFlow(host, frames, new ChatScrollController(positionOptions.storage, positionOptions.saveScheduler), () => { this.tail.syncFollowingAfterNavigation(); }, () => { this.tail.pause(); });
    this.history = new HistoryFlow(host, frames);
    this.prepend = new PrependFlow(host, frames, () => { this.tail.recordScrollBaseline(); });
  }

  get followingLive(): boolean {
    return this.tail.followingLive;
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
    if (!this.position.restoring) this.tail.onScroll();
    this.position.scheduleSave();
    if (!this.position.restoring) this.history.schedule();
  }

  onInteraction(): void {
    // A delayed history-backed restore must not reclaim the user's viewport.
    if (this.disposed) return;
    if (this.position.restoring) {
      this.position.reset();
      this.tail.recordScrollBaseline();
    }
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
    if (end) this.tail.startFollowing();
    else {
      this.tail.pause();
      this.tail.recordScrollBaseline();
    }
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
