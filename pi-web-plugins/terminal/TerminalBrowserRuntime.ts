import type { PluginPeerChannel, WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { SessionStorageTerminalSelectionMemory, terminalSelectionScope, type TerminalSelectionMemory } from "./terminalSelection";
import { TerminalPeerClient, type TerminalInfo } from "./terminalProtocol";

const ACTIVE_TERMINAL_FAILURE_RETRY_MS = 5_000;
type TimerId = ReturnType<typeof globalThis.setTimeout>;
type SetTimer = (handler: () => void, timeout: number) => TimerId;
type ClearTimer = (timer: TimerId) => void;

interface WorkspaceRuntimeState {
  activeCount?: number;
  refreshFailed: boolean;
  retryAt: number;
  refresh: Promise<void> | undefined;
  refreshController: AbortController | undefined;
  watchController: AbortController | undefined;
  channel: PluginPeerChannel | undefined;
  wakeTimer: TimerId | undefined;
  requestRender: () => void;
}

/** Browser-product state shared by this activation's panel, badge, and facade. */
export class TerminalBrowserRuntime {
  private readonly workspaces = new Map<string, WorkspaceRuntimeState>();
  private disposed = false;
  private badgeTarget: { state: WorkspaceRuntimeState; context: WorkspacePanelContext } | undefined;

  constructor(
    readonly selection: TerminalSelectionMemory = new SessionStorageTerminalSelectionMemory(),
    private readonly now: () => number = () => Date.now(),
    private readonly setTimer: SetTimer = (handler, timeout) => globalThis.setTimeout(handler, timeout),
    private readonly clearTimer: ClearTimer = (timer) => { globalThis.clearTimeout(timer); },
  ) {}

  activeTerminalBadge(context: WorkspacePanelContext): number | string | undefined {
    if (this.disposed) return undefined;
    const state = this.workspaceState(context);
    if (this.badgeTarget?.state !== state) this.resetBadgePolling();
    this.badgeTarget = { state, context };
    if (state.watchController === undefined) {
      if (this.now() >= state.retryAt) this.watchActiveCount(context, state);
      else this.scheduleBadgeRetry(state);
    }
    if (state.refreshFailed) return "!";
    return state.activeCount === undefined || state.activeCount === 0 ? undefined : state.activeCount;
  }

  async invalidate(context: WorkspacePanelContext): Promise<void> {
    this.requireActive();
    try {
      await this.refresh(context);
    } finally {
      // Route-only history restoration does not otherwise mutate app state.
      if (!this.disposed) context.host.requestRender();
    }
  }

  async refresh(context: WorkspacePanelContext): Promise<void> {
    this.requireActive();
    const peer = context.peer;
    if (peer === undefined) throw new Error("Required Terminal peer is unavailable");
    const state = this.workspaceState(context);
    if (state.refresh !== undefined) return state.refresh;
    const controller = new AbortController();
    const refresh = new TerminalPeerClient(peer).list(controller.signal).then((terminals) => {
      this.updateTerminals(context, terminals);
    }).catch((error: unknown) => {
      if (this.disposed || controller.signal.aborted) throw error;
      const changed = !state.refreshFailed;
      state.refreshFailed = true;
      if (changed) state.requestRender();
      throw error;
    }).finally(() => {
      if (state.refresh === refresh) {
        state.refresh = undefined;
        state.refreshController = undefined;
      }
    });
    state.refresh = refresh;
    state.refreshController = controller;
    return refresh;
  }

  updateTerminals(context: WorkspacePanelContext, terminals: readonly TerminalInfo[]): void {
    if (this.disposed) return;
    const state = this.workspaceState(context);
    this.updateActiveCount(state, terminals.reduce((count, terminal) => count + (terminal.exited ? 0 : 1), 0));
  }

  private updateActiveCount(state: WorkspaceRuntimeState, activeCount: number): void {
    const changed = state.activeCount !== activeCount || state.refreshFailed;
    state.activeCount = activeCount;
    state.refreshFailed = false;
    if (changed) state.requestRender();
  }

  private watchActiveCount(context: WorkspacePanelContext, state: WorkspaceRuntimeState): void {
    const controller = new AbortController();
    state.watchController = controller;
    const failed = (): void => {
      if (controller.signal.aborted || this.disposed || this.badgeTarget?.state !== state) return;
      state.watchController = undefined;
      state.channel = undefined;
      controller.abort();
      const changed = !state.refreshFailed;
      state.refreshFailed = true;
      state.retryAt = this.now() + ACTIVE_TERMINAL_FAILURE_RETRY_MS;
      this.scheduleBadgeRetry(state);
      if (changed) state.requestRender();
    };
    // One scoped channel publishes a snapshot and changes. Idle badges never
    // issue terminal.list requests or repeat workspace/Git authority discovery.
    void Promise.resolve().then(async () => {
      if (context.peer === undefined) throw new Error("Required Terminal peer is unavailable");
      return new TerminalPeerClient(context.peer).watchActiveCount((count) => {
        if (!controller.signal.aborted && !this.disposed && this.badgeTarget?.state === state) {
          this.updateActiveCount(state, count);
        }
      }, controller.signal);
    }).then((channel) => {
      if (controller.signal.aborted || this.disposed || this.badgeTarget?.state !== state) {
        channel.close("Terminal badge workspace changed");
        return;
      }
      state.channel = channel;
      void channel.closed.then(failed, failed);
    }).catch(failed);
  }

  private scheduleBadgeRetry(state: WorkspaceRuntimeState): void {
    if (this.badgeTarget?.state !== state || state.wakeTimer !== undefined) return;
    state.wakeTimer = this.setTimer(() => {
      state.wakeTimer = undefined;
      const target = this.badgeTarget;
      if (this.disposed || target?.state !== state || state.watchController !== undefined) return;
      this.watchActiveCount(target.context, state);
    }, Math.max(0, state.retryAt - this.now()));
  }

  workspaceScope(context: WorkspacePanelContext): string {
    return JSON.stringify([context.machine.id, context.workspace.projectId, context.workspace.id, context.workspace.path]);
  }

  selectionScope(context: WorkspacePanelContext): string {
    return terminalSelectionScope(context.machine.id, context.workspace.path);
  }

  routedTerminalId(context: WorkspacePanelContext): string | undefined {
    return navigationValue(context, "terminal");
  }

  selectedTerminalId(context: WorkspacePanelContext): string | undefined {
    return this.routedTerminalId(context) ?? this.selection.latestTerminalId(this.selectionScope(context));
  }

  autoStartRequest(context: WorkspacePanelContext): string | undefined {
    return navigationValue(context, "start");
  }

  selectTerminal(context: WorkspacePanelContext, terminalId: string | undefined, options?: { replace?: boolean | undefined }): boolean {
    const navigationResult: unknown = context.navigation?.set("terminal", terminalId, options);
    if (navigationResult === false) return false;
    const scope = this.selectionScope(context);
    if (terminalId === undefined) this.selection.forgetWorkspace(scope);
    else this.selection.rememberTerminal(scope, terminalId);
    context.host.requestRender();
    return true;
  }

  forgetTerminal(terminalId: string): void {
    if (!this.disposed) this.selection.forgetTerminal(terminalId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resetBadgePolling();
    for (const state of this.workspaces.values()) state.refreshController?.abort(new DOMException("Terminal browser runtime disposed", "AbortError"));
    this.workspaces.clear();
  }

  private resetBadgePolling(): void {
    this.badgeTarget = undefined;
    for (const state of this.workspaces.values()) {
      if (state.wakeTimer !== undefined) this.clearTimer(state.wakeTimer);
      state.wakeTimer = undefined;
      state.watchController?.abort();
      state.watchController = undefined;
      state.channel?.close("Terminal badge workspace changed");
      state.channel = undefined;
    }
  }

  private requireActive(): void {
    if (this.disposed) throw new DOMException("Terminal browser runtime disposed", "AbortError");
  }

  private workspaceState(context: WorkspacePanelContext): WorkspaceRuntimeState {
    const key = this.workspaceScope(context);
    const existing = this.workspaces.get(key);
    if (existing !== undefined) {
      existing.requestRender = () => { context.host.requestRender(); };
      return existing;
    }
    const state: WorkspaceRuntimeState = {
      refreshFailed: false, retryAt: 0, refresh: undefined, refreshController: undefined,
      watchController: undefined, channel: undefined, wakeTimer: undefined,
      requestRender: () => { context.host.requestRender(); },
    };
    this.workspaces.set(key, state);
    return state;
  }
}

function navigationValue(context: WorkspacePanelContext, key: string): string | undefined {
  const value = context.navigation?.query[key];
  const first = typeof value === "string" ? value : value?.[0];
  return first === undefined || first === "" ? undefined : first;
}
