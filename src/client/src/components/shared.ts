import { css, svg, type TemplateResult } from "lit";
import type { AskUserOutcome, AskUserRequest } from "../../../shared/apiTypes";
import type { ImageDimensions, SessionMediaReference } from "../../../shared/sessionMedia";
import type { SessionWarningSeverity } from "../api";
import { uiButtonStyles, uiMenuStyles, uiToolbarStyles, uiTabStyles } from "./ui/controlStyles";
import { uiTranscriptStyles } from "./ui/transcriptStyles";

/** Shared downstream shadow for content passing beneath sticky scroll controls. */
export const scrollHideShadow = css`0 8px 18px var(--pi-shadow-soft)`;
/** Directional navigation shadow that avoids a halo above the fixed heading edge. */
export const scrollBoundaryShadow = css`0 8px 18px -8px var(--pi-shadow-soft)`;

export function renderSessionWarningIcon(severity: SessionWarningSeverity, className: string): TemplateResult {
  if (severity === "error") {
    return svg`
      <svg class=${className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="m15 9-6 6"></path>
        <path d="m9 9 6 6"></path>
      </svg>
    `;
  }
  if (severity === "info") {
    return svg`
      <svg class=${className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M12 11v5"></path>
        <path d="M12 8h.01"></path>
      </svg>
    `;
  }
  return svg`
    <svg class=${className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.3 3.7 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z"></path>
      <path d="M12 9v4"></path>
      <path d="M12 17h.01"></path>
    </svg>
  `;
}

export interface ToolPreview {
  diff?: string;
  firstChangedLine?: number;
  error?: string;
}

export interface ToolExecutionPart {
  type: "toolExecution";
  toolCallId?: string;
  toolName: string;
  summary: string;
  args?: unknown;
  status: "pending" | "running" | "success" | "error";
  resultText?: string;
  content?: unknown;
  details?: unknown;
  preview?: ToolPreview;
}

/** A reference never carries base64; inline images remain compatible with older machines. */
export type ChatImagePart =
  | ({ type: "image"; mimeType: string; data: string; mediaId?: never; byteSize?: never } & Partial<ImageDimensions>)
  | (SessionMediaReference & { data?: never });

export type ChatPart =
  | { type: "text"; text: string; displayText?: string }
  | ChatImagePart
  | { type: "thinking"; text: string; displayText?: string }
  | { type: "skillInvocation"; name: string; location: string; content: string }
  | { type: "skillRead"; name: string; path: string; toolCallId?: string }
  | { type: "askUserQuestion"; ask: AskUserRequest }
  | { type: "askUserRecord"; outcome: AskUserOutcome }
  /** Retain a coalesced result's conversation position without repeating its UI. */
  | { type: "toolResultBoundary"; toolCallId?: string }
  | { type: "toolCall"; toolCallId?: string; toolName: string; summary: string; args?: unknown }
  | ToolExecutionPart
  | { type: "toolResult"; toolCallId?: string; toolName: string; text: string; isError: boolean; content?: unknown; details?: unknown }
  | { type: "empty" };

export interface ChatLine {
  /** Identity of one live assistant message, retained through finalization. */
  streamId?: string;
  /** Durable session-tree entry; absent for optimistic or in-flight messages. */
  entryId?: string;
  role: "user" | "assistant" | "tool" | "system" | "bash" | "skill";
  parts: ChatPart[];
  source?: "compaction" | "branch_summary";
  meta?: {
    timestamp?: string;
    model?: { provider?: string; id?: string; responseId?: string };
    /** Thinking level the assistant message was generated with, when known. */
    thinkingLevel?: string;
  };
}

export interface CompletionItem {
  kind: "command" | "file" | "model";
  replaceFrom: number;
  replaceTo: number;
  insertText: string;
  detail: string;
  description?: string;
  /** Pi-style argument hint (e.g. `<PR-URL>`) for commands that declare one. */
  argumentHint?: string;
  cursorOffset?: number;
}

export const appStyles = css`
  /* Mobile browsers already subtract browser controls from 100dvh; reserve bottom safe area only in standalone PWA modes. */
  :host { --pi-app-safe-area-bottom: 0px; position: fixed; top: 0; right: 0; left: 0; display: block; height: 100dvh; box-sizing: border-box; overflow: hidden; padding: env(safe-area-inset-top) env(safe-area-inset-right) var(--pi-app-safe-area-bottom) env(safe-area-inset-left); color: var(--pi-text); background: var(--pi-bg); font: 14px system-ui, sans-serif; }
  :host([pwa-display-mode]) { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  @media (display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui) {
    :host { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  }
  .shell { --navigation-panel-size: 340px; --workspace-panel-size: minmax(360px, 42vw); --navigation-panel-width: var(--navigation-panel-size); --workspace-panel-width: var(--workspace-panel-size); display: grid; grid-template-columns: var(--navigation-panel-width) 1px minmax(320px, 1fr) 1px var(--workspace-panel-width); height: 100%; min-height: 0; }
  aside { grid-column: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  aside app-navigation-panel { flex: 1 1 auto; min-height: 0; }
  header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border-bottom: 1px solid var(--pi-border); }
  .header-actions { display: flex; align-items: center; gap: 8px; }
  main { grid-column: 3; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .context-bar { position: relative; flex: 0 0 auto; min-width: 0; display: none; align-items: center; gap: 0; padding: 6px 0; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); }
  .context-bar::before, .context-bar::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 20px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
  .context-bar::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .context-bar::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .context-bar.can-scroll-left::before, .context-bar.can-scroll-right::after { opacity: 1; }
  .context-bar-label { display: none; }
  .context-items { flex: 1 1 auto; min-width: 0; display: flex; align-items: stretch; gap: 5px; margin: 0; padding: 0 8px; list-style: none; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scroll-padding-inline: 8px; scrollbar-width: thin; }
  .context-bar.has-context-actions .context-items { padding-right: 52px; scroll-padding-inline: 8px 52px; }
  .context-item { flex: 0 0 auto; min-width: 0; display: flex; }
  .context-actions { position: absolute; top: 6px; right: 0; bottom: 6px; z-index: 3; display: flex; align-items: center; padding: 0 8px 0 0; pointer-events: none; }
  .context-actions::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; z-index: 0; width: 26px; background: var(--pi-bg); pointer-events: none; }
  .context-chip { flex: 0 0 auto; min-width: 0; display: inline-flex; align-items: baseline; gap: 5px; border: 1px solid var(--pi-border-muted); border-radius: 999px; background: var(--pi-surface); color: var(--pi-text); padding: 4px 8px; font: inherit; text-align: left; }
  .context-chip:hover { background: var(--pi-surface-hover); }
  .context-chip:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
  .context-chip.empty { border-style: dashed; color: var(--pi-muted); }
  .context-kind { display: none; }
  .context-value { min-width: 0; overflow: visible; text-overflow: clip; white-space: nowrap; }
  app-mobile-main-tabs { display: none; }
  app-mobile-main-tabs[panel-controls] { display: block; }
  .mobile-tabs-frame { position: relative; display: none; flex: 0 0 auto; min-width: 0; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
  .mobile-tabs-frame::before, .mobile-tabs-frame::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 20px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
  .mobile-tabs-frame::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .mobile-tabs-frame::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .mobile-tabs-frame.can-scroll-left::before, .mobile-tabs-frame.can-scroll-right::after { opacity: 1; }
  .mobile-tabs { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 8px; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; }
  .mobile-tabs button { flex: 0 0 auto; white-space: nowrap; }
  .mobile-navigation-tab, .mobile-navigation-panel { display: none; }
  .mobile-tabs button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  .tab-badge { display: inline-block; min-width: 14px; margin-left: 4px; border: 1px solid var(--pi-success-border); border-radius: 999px; background: var(--pi-success-surface); color: var(--pi-success); padding: 0 5px; font-size: 11px; line-height: 16px; text-align: center; }
  workspace-panel { grid-column: 5; min-width: 0; min-height: 0; overflow: hidden; }
  @media (min-width: 1181px) {
    .shell.navigation-panel-collapsed { --navigation-panel-width: 0px; }
    .shell.navigation-panel-collapsed > aside { display: none; }
    .shell.two-column-layout.workspace-panel-collapsed { grid-template-columns: var(--navigation-panel-width) 1px minmax(0, 1fr) 1px; }
    .shell.workspace-panel-collapsed > app-panel-edge-control[side="workspace"] { grid-row: 1 / 3; }
  }
  .shell.two-column-layout { grid-template-columns: var(--navigation-panel-width) 1px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .shell.two-column-layout.navigation-panel-collapsed { --navigation-panel-width: 0px; }
  .shell.two-column-layout.navigation-panel-collapsed > aside { display: none; }
  .two-column-layout > aside, .two-column-layout > app-panel-edge-control[side="navigation"] { grid-row: 1 / 3; }
  .two-column-layout main { grid-column: 3; grid-row: 1 / 3; }
  .two-column-layout app-mobile-main-tabs { display: block; flex: 0 0 auto; min-width: 0; }
  .two-column-layout .mobile-tabs-frame { display: flex; }
  .shell.two-column-layout.workspace-view main { grid-row: 1; min-height: auto; }
  .shell.two-column-layout.workspace-view > workspace-panel { grid-column: 3; grid-row: 2; display: flex; border-left: 0; }
  .shell.two-column-layout:not(.workspace-view) > workspace-panel { display: none; }
  .two-column-layout main.workspace-view chat-view, .two-column-layout main.workspace-view .composer-area, .two-column-layout main.workspace-view status-bar,
  .two-column-layout main.workspace-view .empty { display: none; }
  .two-column-layout main.workspace-view { overflow: hidden; }
  @media (max-width: 760px) {
    .shell.two-column-layout { grid-template-columns: minmax(0, 1fr); }
    aside { display: none; }
    .two-column-layout main, .shell.two-column-layout.workspace-view > workspace-panel { grid-column: 1; }
    .context-bar { display: flex; }
    .mobile-navigation-tab { display: block; }
    main.navigation-view chat-view, main.navigation-view .composer-area, main.navigation-view status-bar,
    main.navigation-view .empty { display: none; }
    main.navigation-view .mobile-navigation-panel { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    main.navigation-view .mobile-navigation-panel app-navigation-panel { flex: 1 1 auto; min-height: 0; }
  }
  status-bar { flex: 0 0 auto; }
  chat-view { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .composer-area { position: relative; z-index: 5; flex: 0 0 auto; display: grid; min-width: 0; background: var(--pi-bg); }
  /* Share a grid cell instead of adding banner height; allow long notices to grow the area rather than clip their controls. */
  .composer-area > prompt-editor, .composer-activity-notice { grid-area: 1 / 1; min-width: 0; }
  .composer-area > prompt-editor[inert] { visibility: hidden; }
  .composer-activity-notice { z-index: 6; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 16px; border-top: 1px solid var(--pi-warning-border); background: var(--pi-warning-surface); color: var(--pi-warning); }
  .composer-activity-notice-text { flex: 1 1 240px; min-width: 0; overflow-wrap: anywhere; }
  .composer-activity-notice p { margin: 0; }
  .composer-activity-notice button { flex: 0 0 auto; }
  button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
  .empty { margin: auto; color: var(--pi-muted); }
  .error { display: flex; gap: 8px; align-items: flex-start; padding: 10px 16px; border-bottom: 1px solid var(--pi-border); color: var(--pi-danger); }
  .error.warning { border-bottom-color: var(--pi-warning-border); color: var(--pi-warning); background: var(--pi-warning-surface); }
  .error.info { border-bottom-color: var(--pi-accent-border); color: var(--pi-text); background: var(--pi-selection-bg); }
  .error .error-text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .error .error-dismiss { flex: 0 0 auto; padding: 0 6px; border: 0; background: none; color: inherit; line-height: 1.4; }
  .deprecation-notice { padding: 10px 16px; border-bottom: 1px solid var(--pi-border); color: var(--pi-warning); }
  .deprecation-notice .deprecation-notice-text { margin: 0; overflow-wrap: anywhere; }
  .deprecation-notice .deprecation-notice-text + .deprecation-notice-text { margin-top: 4px; }
`;

export const workspacePanelStyles = css`
  ${uiButtonStyles}
  ${uiToolbarStyles}
  ${uiTabStyles}
  :host { display: flex; flex-direction: column; min-height: 0; color: var(--pi-text); background: var(--pi-bg); font: 13px system-ui, sans-serif; container-type: inline-size; }
  header { display: flex; align-items: stretch; flex: 0 0 auto; min-width: 0; border-bottom: 1px solid var(--pi-border); }
  .navigation-menu-button { flex: 0 0 auto; justify-content: center; min-width: 44px; margin: 0; }
  .panel-toggle { margin-inline-start: auto; border-inline-start: 1px solid var(--pi-border-muted); }
  .workspace-header-scroll-frame { flex: 1 1 auto; display: flex; position: relative; min-width: 0; background: var(--pi-bg); }
  .workspace-header-scroll-frame::before, .workspace-header-scroll-frame::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 18px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
  .workspace-header-scroll-frame::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .workspace-header-scroll-frame::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .workspace-header-scroll-frame.can-scroll-left::before, .workspace-header-scroll-frame.can-scroll-right::after { opacity: 1; }
  .workspace-header-strip { flex: 1 1 auto; display: flex; justify-content: space-between; align-items: stretch; gap: 0; min-width: 0; padding: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; }
  .tabs button.icon-tab { min-width: 44px; }
  .tab-icon { flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .tab-custom-icon { flex: 0 0 auto; width: 16px; height: 16px; display: inline-grid; place-items: center; color: currentColor; pointer-events: none; }
  .tab-custom-icon svg { width: 16px; height: 16px; pointer-events: none; }
  .tab-label { min-width: 0; }
  .tab-badge { flex: 0 0 auto; display: inline-block; min-width: 14px; border: 1px solid var(--pi-success-border); border-radius: 999px; background: var(--pi-success-surface); color: var(--pi-success); padding: 0 5px; font-size: 11px; line-height: 16px; text-align: center; }
  @container (max-width: 430px) {
    .tabs button.icon-tab { justify-content: center; padding-inline: 10px; }
  }
  .panel-content { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
  .empty-state { box-sizing: border-box; width: min(100%, 380px); margin: auto; padding: 24px; display: grid; gap: 8px; color: var(--pi-muted); text-align: center; }
  .empty-state h2 { margin: 0; color: var(--pi-text); font-size: 15px; line-height: 1.3; }
  .empty-state p { margin: 0; line-height: 1.45; }
  small, .muted { color: var(--pi-muted); }
  @media (max-width: 1180px) { header { display: none; } }
  .workspace-label { min-width: 0; display: inline-flex; align-items: baseline; gap: 5px; max-width: 100%; overflow: hidden; white-space: nowrap; }
  .workspace-label-base, .workspace-label-item, .workspace-label-render { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .workspace-label-item, .workspace-label-render, .workspace-label-separator { color: var(--pi-muted); }
  .workspace-label-link { color: var(--pi-accent); text-decoration: none; }
  .workspace-label-link:hover, .workspace-label-link:focus { text-decoration: underline; }
`;

export const listStyles = css`
  ${uiButtonStyles}
  ${uiToolbarStyles}
  ${uiMenuStyles}
  :host { display: flex; flex-direction: column; min-height: 0; overflow: hidden; color: var(--pi-text); font: 14px system-ui, sans-serif; }
  :host([collapsed]) { flex: 0 0 auto; min-height: auto; overflow: hidden; }
  section { box-sizing: border-box; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 0; }
  h2 { flex: 0 0 auto; margin: 0; color: var(--pi-muted); font-size: 12px; text-transform: uppercase; }
  h2.ui-toolbar { border-bottom: 1px solid var(--pi-border-muted); }
  section > h2 { position: relative; z-index: 3; background: var(--pi-bg); box-shadow: ${scrollBoundaryShadow}; }
  .list-body { flex: 1 1 auto; min-height: 0; overflow: auto; }
  .subheading { margin-top: 14px; }
  .section-toggle { width: 100%; gap: 8px; }
  .section-toggle span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .section-title { display: grid; gap: 2px; min-width: 0; }
  .section-toggle .section-selected { display: block; color: var(--pi-text); font-size: 12px; font-weight: 600; line-height: 1.25; text-transform: none; }
  .section-toggle .section-count { flex: 0 0 auto; display: inline; color: var(--pi-muted); font-size: inherit; }
  .section-toggle small { display: inline; color: inherit; font-size: inherit; }
  .action-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; margin: 6px 0; cursor: pointer; }
  .action-row:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; border-radius: 8px; }
  .action-row.selected .action-main { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  .action-row.archived .action-main { color: var(--pi-muted); }
  .action-main { position: relative; box-sizing: border-box; min-width: 0; width: 100%; border: 1px solid var(--pi-border); border-top-right-radius: 0; border-bottom-right-radius: 0; border-top-left-radius: 8px; border-bottom-left-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 22px 7px calc(9px + var(--depth, 0) * 16px); text-align: left; }
  .action-name { display: -webkit-box; max-height: 2.5em; overflow: hidden; overflow-wrap: anywhere; line-height: 1.25; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .action-row:not(.selected):hover .action-main { background: var(--pi-surface-hover); }
  .workspace-row .action-main { border-radius: 8px 0 0 8px; }
  .workspace-primary { min-width: 0; display: flex; align-items: baseline; gap: 6px; }
  .workspace-primary-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspace-status { flex: 0 0 auto; color: var(--pi-warning); font-size: 12px; }
  .workspace-secondary { margin-top: 3px; }
  .workspace-menu-actions { margin: 0 0 8px; padding-bottom: 8px; border-bottom: 1px solid var(--pi-border-muted); }
  .workspace-menu-details { display: grid; gap: 6px; margin: 0; padding: 0 9px 5px; }
  .workspace-detail-row { display: grid; grid-template-columns: minmax(58px, max-content) minmax(0, 1fr); gap: 8px; align-items: baseline; }
  .workspace-detail-row dt { color: var(--pi-muted); font-size: 12px; white-space: normal; }
  .workspace-detail-row dd { min-width: 0; margin: 0; overflow-wrap: anywhere; white-space: normal; }
  .detail-copy { margin-left: 6px; vertical-align: middle; }
  .tree-marker { color: var(--pi-dim); margin-right: 5px; }
  .badge { display: inline-block; margin-left: 5px; border: 1px solid var(--pi-border); border-radius: 999px; color: var(--pi-muted); padding: 0 5px; font-size: 11px; font-weight: 400; }
  .action-activity { position: absolute; top: 50%; inset-inline-start: calc(6px + var(--depth, 0) * 16px + var(--agent-offset, 0px)); transform: translateY(-50%); z-index: 1; display: grid; place-items: center; width: 10px; height: 10px; }
  .action-activity .activity-indicator { margin: 0; vertical-align: 0; }
  .activity-indicator { flex: 0 0 auto; display: inline-block; width: 7px; height: 7px; margin-right: 6px; background: var(--pi-success); animation: pulse 1s ease-in-out infinite; vertical-align: 1px; }
  .activity-indicator.session { border-radius: 50%; background: var(--pi-success); }
  .activity-indicator.terminal { border-radius: 2px; background: var(--pi-accent); }
  /* Client-side sending (upload in flight); distinct from server activity, which propagates to workspace/machine rows. */
  .activity-indicator.sending { border-radius: 50%; background: var(--pi-warning); }
  /* Unread is a stable state, not ongoing work: keep it static and accent-colored. */
  .activity-indicator.unread { border-radius: 50%; background: var(--pi-accent); animation: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--pi-accent) 20%, transparent); }
  /* Unread + ongoing work: a static accent ring wraps the still-pulsing work dot. */
  .unread-ring { flex: 0 0 auto; box-sizing: border-box; display: inline-grid; place-items: center; width: 9px; height: 9px; margin-right: 6px; border: 1.5px solid var(--pi-accent); border-radius: 50%; vertical-align: 1px; }
  .unread-ring .activity-indicator { width: 5px; height: 5px; margin: 0; vertical-align: 0; }
  .action-activity .unread-ring { margin: 0; vertical-align: 0; }
  .action-menu { position: relative; align-self: stretch; }
  .action-menu-toggle { height: 100%; }
  .action-menu-panel { position: fixed; z-index: 50; min-width: min(120px, calc(100vw - 16px)); overflow-wrap: anywhere; }
  .action-menu-description { display: block; padding: 0 9px 7px; color: var(--pi-muted); font-size: 12px; line-height: 1.4; white-space: normal; overflow-wrap: anywhere; }
  .action-menu-description a { color: var(--pi-accent); text-decoration: none; }
  .action-menu-description a:hover, .action-menu-description a:focus-visible { text-decoration: underline; }
  .action-menu-error { color: var(--pi-danger, #c0392b); }
  small { display: block; color: var(--pi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspace-label { min-width: 0; display: inline-flex; align-items: baseline; gap: 5px; max-width: 100%; overflow: hidden; white-space: nowrap; }
  .workspace-label-base, .workspace-label-item, .workspace-label-render { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .workspace-label-item, .workspace-label-render, .workspace-label-separator { color: var(--pi-muted); }
  .workspace-label-link { color: var(--pi-accent); text-decoration: none; }
  .workspace-label-link:hover, .workspace-label-link:focus { text-decoration: underline; }
  .workspace-detail-row .workspace-label { overflow: visible; white-space: normal; flex-wrap: wrap; }
  .workspace-detail-row .workspace-label-base, .workspace-detail-row .workspace-label-item, .workspace-detail-row .workspace-label-render { overflow: visible; text-overflow: clip; overflow-wrap: anywhere; white-space: normal; }
  @keyframes pulse { 0%, 100% { transform: scale(.75); opacity: .55; } 50% { transform: scale(1.2); opacity: 1; } }
`;

export const chatStyles = css`
  ${uiButtonStyles}
  ${uiToolbarStyles}
  ${uiTranscriptStyles}
  :host { position: relative; z-index: 0; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; color: var(--pi-text); font: 14px system-ui, sans-serif; }
  .chat-wrap { --pi-chat-jump-size: 28px; position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  .top-notices { box-sizing: border-box; flex: 0 0 auto; max-height: 40%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg-overlay); }
  .session-warnings { flex: 0 1 auto; display: grid; gap: 0; max-height: 50%; min-height: 0; overflow-y: auto; box-sizing: border-box; padding: 0; border-bottom: 1px solid var(--pi-border-muted); }
  .session-warnings:only-child { flex: 1 1 auto; max-height: 100%; border-bottom: 0; }
  .session-warnings-controls { display: flex; justify-content: flex-end; padding-inline: 16px; }
  .session-warnings-collapse-icon { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .session-warning { --ui-transcript-bg: var(--pi-warning-surface); --warning-colour: var(--pi-warning); position: relative; display: grid; gap: 4px; min-height: 44px; padding: 10px 44px 10px 16px; color: var(--pi-text); }
  .session-warning.error { --ui-transcript-bg: color-mix(in srgb, var(--pi-danger) 12%, var(--pi-surface)); --warning-colour: var(--pi-danger); }
  .session-warning.info { --ui-transcript-bg: var(--pi-selection-bg); --warning-colour: var(--pi-accent); }
  .session-warning-head { display: flex; align-items: center; gap: 8px; min-height: 16px; color: var(--warning-colour); }
  .session-warning-icon { flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .session-warning-body { min-width: 0; display: grid; gap: 3px; }
  .session-warning-message { margin: 0; overflow-wrap: anywhere; }
  .session-warning-path { margin: 0; color: var(--pi-muted); font-size: 12px; font-family: var(--pi-mono, ui-monospace, monospace); overflow-wrap: anywhere; }
  .session-warning-source { color: var(--pi-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .session-warning-dismiss { position: absolute; top: 6px; right: 6px; font-size: 18px; }
  @media (pointer: coarse) {
    .session-warning { min-height: 56px; padding-right: 56px; }
  }
  .notification-tray { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; background: var(--pi-bg-overlay); }
  .notification-tray.collapsed { flex: 0 0 auto; }
  .notification-header { position: sticky; top: 0; z-index: 2; flex: 0 0 auto; min-width: 0; display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: 8px; box-sizing: border-box; min-height: 40px; padding: 4px 10px; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg-overlay); }
  .notification-tray.collapsed .notification-header { border-bottom: 0; }
  .notification-header:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -3px; }
  .notification-heading { min-width: 0; flex: 1 1 auto; overflow: hidden; color: var(--pi-text-bright); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .notification-header-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; }
  .notification-control, .notification-row-dismiss { box-sizing: border-box; min-height: 32px; border: 0; border-radius: 6px; background: transparent; color: var(--pi-muted); cursor: pointer; }
  .notification-control { padding: 0 7px; font: 12px system-ui, sans-serif; white-space: nowrap; }
  .notification-toggle { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; }
  .notification-control:hover, .notification-control:focus-visible, .notification-row-dismiss:hover, .notification-row-dismiss:focus-visible { background: var(--pi-selection-bg); color: var(--pi-text-bright); }
  .notification-control:focus-visible, .notification-row-dismiss:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
  .notification-control:disabled, .notification-row-dismiss:disabled { opacity: .5; background: transparent; cursor: default; }
  .notification-icon { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .notification-disclosure-icon.expanded { transform: rotate(90deg); }
  .notification-close-icon { width: 16px; height: 16px; }
  .notification-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; box-sizing: border-box; padding: 0 10px 5px; }
  .notification-list[hidden] { display: none; }
  .notification-overflow { margin: 0; padding: 7px 2px; border-bottom: 1px solid var(--pi-border-muted); color: var(--pi-muted); font-size: 11px; overflow-wrap: anywhere; }
  .notification-row { position: relative; min-width: 0; display: grid; gap: 4px; box-sizing: border-box; padding: 9px 38px 9px 2px; border-bottom: 1px solid var(--pi-border-muted); color: var(--pi-text); }
  .notification-row:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
  .notification-metadata { min-width: 0; display: flex; align-items: baseline; gap: 5px; color: var(--pi-muted); font-size: 11px; }
  .notification-severity { color: var(--pi-muted); font-size: inherit; font-weight: 600; }
  .notification-row.warning .notification-severity { color: var(--pi-warning); }
  .notification-row.error .notification-severity { color: var(--pi-danger); }
  .notification-message { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; text-align: start; unicode-bidi: plaintext; }
  .notification-truncated { margin: 0; color: var(--pi-muted); font-size: 11px; overflow-wrap: anywhere; }
  .notification-row-dismiss { position: absolute; top: 5px; right: 0; display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; }
  .visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; border: 0 !important; }
  .notification-live span { display: block; }
  @media (pointer: coarse) {
    .notification-control, .notification-row-dismiss { min-height: 34px; }
    .notification-toggle, .notification-row-dismiss { width: 34px; height: 34px; }
    .notification-row { padding-right: 40px; }
  }
  @media (max-width: 520px) {
    .notification-header { gap: 4px; padding-inline: 8px; }
    .notification-list { padding-inline: 8px; }
  }
  .chat { --pi-chat-conversation-bg: color-mix(in srgb, var(--pi-muted) 6%, var(--pi-bg)); --pi-chat-sticky-top: 0px; flex: 1 1 auto; min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; padding: 0 0 16px; box-sizing: border-box; }
  .chat-jumps { position: absolute; right: 0; bottom: 0; z-index: 21; display: flex; gap: 0; }
  .chat-jumps button { display: inline-grid; place-items: center; box-sizing: border-box; width: var(--pi-chat-jump-size); height: var(--pi-chat-jump-size); padding: 0; border: 0; border-radius: 0; background: var(--pi-bg); color: var(--pi-muted); font: 16px/1 system-ui, sans-serif; cursor: pointer; }
  .chat-jumps button + button { border-inline-start: 1px solid var(--pi-border-muted); }
  .chat-jumps button.following { color: var(--pi-accent); background: var(--pi-selection-bg); }
  .chat-jumps button:hover, .chat-jumps button:focus-visible { color: var(--pi-text-bright); background: var(--pi-selection-bg); }
  .chat-jumps button:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
  .chat-wrap.plain .msg-header, .chat-wrap.plain .event-group > summary { position: static; top: auto; }
  .chat-wrap.plain *, .chat-wrap.plain *::before, .chat-wrap.plain *::after { transition: none !important; animation: none !important; box-shadow: none !important; text-shadow: none !important; filter: none !important; backdrop-filter: none !important; transform: none !important; border-radius: 0 !important; }
  .chat-wrap.plain .chat-image { --pi-image-radius: 0; }
  @media (pointer: coarse) {
    .chat-wrap { --pi-chat-jump-size: 44px; }
  }
  /* Reserve equal space on both sides so the centered notice clears both jump targets by 8px. */
  .activity-dock { position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); z-index: 20; display: flex; align-items: center; gap: 6px; width: 240px; max-width: calc(100% - var(--pi-chat-jump-size) * 4 - 16px); min-width: 0; box-sizing: border-box; border: 1px solid var(--pi-border); border-bottom: 0; border-radius: 8px 8px 0 0; background: var(--pi-bg-overlay); color: var(--pi-muted); padding: 3px 10px; font-size: 11px; line-height: 16px; pointer-events: none; backdrop-filter: blur(6px); }
  .activity-dock.active { border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-bg-overlay); }
  .activity-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: .45; flex: 0 0 auto; }
  .activity-dock.active .dot { width: 6px; height: 6px; animation: pulse 1s ease-in-out infinite; opacity: 1; }
  .msg { --ui-transcript-bg: var(--pi-bg); display: flow-root; max-width: 100%; min-width: 0; margin: 0; padding: 12px 16px 16px; overflow: visible; }
  .chat > .msg:last-child, .chat > .session-activity:last-child { margin-bottom: 0; }
  .msg.conversation-message { --ui-transcript-bg: var(--pi-chat-conversation-bg); --formatted-link-color: color-mix(in srgb, var(--pi-accent) 45%, var(--pi-text) 55%); --formatted-muted-color: color-mix(in srgb, var(--pi-text-secondary) 80%, var(--pi-text) 20%); border-inline-start: 3px solid color-mix(in srgb, var(--pi-muted) 55%, var(--pi-border) 45%); padding-inline-start: 13px; }
  .msg.user { --ui-transcript-bg: color-mix(in srgb, var(--pi-accent) 6%, var(--pi-bg)); border-inline-start-color: color-mix(in srgb, var(--pi-accent) 55%, var(--pi-bg)); }
  .msg.conversation-message > .msg-header .msg-header-trailing { opacity: 1; }
  .msg.conversation-message > .msg-header .ui-button { color: var(--formatted-muted-color); }
  .msg.conversation-message > .msg-header .ui-button:focus-visible { outline-color: var(--pi-text); }
  .msg.tool { color: var(--pi-text); }
  .msg.tool-execution-shell, .msg.ask-user-record-shell { padding: 0; border: 0; background: transparent; color: var(--pi-text); }
  .msg.ask-user-record-shell ask-user-card { margin: 0 auto; }
  .msg.system { --ui-transcript-bg: color-mix(in srgb, var(--pi-surface) 40%, var(--pi-bg)); color: var(--pi-text-secondary); }
  .msg.event-group { --ui-activity-tone: var(--pi-border); --ui-transcript-bg: var(--pi-bg); --ui-transcript-heading-bg: var(--pi-bg); padding: 0; color: var(--pi-text); }
  .msg.event-group > summary { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 8px; padding-inline: 13px; }
  .msg.event-group > summary:hover { background: var(--pi-surface-hover); }
  .msg.event-group > summary .label { flex: 0 0 auto; margin: 0; color: inherit; font-weight: 600; }
  .msg.event-group > summary > span { min-width: 0; overflow-wrap: anywhere; }
  .group-body { --ui-activity-edge-width: 0px; padding: 0; }
  .group-msg + .group-msg { border-block-start: 1px solid var(--pi-muted); }
  /* Let tool surfaces draw this shared separator using their own state tone. */
  .group-msg + .group-msg.tool-execution-shell { border-block-start: 0; --ui-activity-separator-width: 1px; }
  .group-msg.tool-execution-shell { padding: 0; }
  .chat-image { --pi-image-max-height: 320px; --pi-image-radius: 8px; display: block; max-width: 100%; margin: 8px 0 0; }
  .tool-image-thumbnails { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0; }
  .image-output-sources { margin-top: 4px; }
  .image-output-source { padding: 4px 12px; }
  .image-output-source + .image-output-source { border-top: 1px solid var(--pi-border-muted); }
  dialog.image-zoom { position: fixed; inset: 0; margin: auto; box-sizing: border-box; width: min(1100px, calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right))); height: min(900px, calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom))); max-width: none; max-height: none; padding: 0; border: 1px solid var(--pi-border); border-radius: 0; color: var(--pi-text); background: var(--pi-bg); overflow: hidden; }
  dialog.image-zoom[open] { display: flex; flex-direction: column; }
  dialog.image-zoom::backdrop { background: var(--pi-overlay); }
  .image-gallery-header { border-bottom: 1px solid var(--pi-border); }
  .image-gallery-position { padding-inline: 12px; }
  .image-gallery-stage { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; background: var(--pi-surface); touch-action: pan-y pinch-zoom; }
  .image-zoom-full { display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: contain; }
  .image-gallery-navigation { border-top: 1px solid var(--pi-border); }
  .image-gallery-navigation .ui-button { flex: 1 1 0; }
  .group-msg { display: flow-root; max-width: 100%; min-width: 0; padding: 8px 12px; color: var(--pi-text); overflow: visible; }
  .group-msg.system { color: var(--pi-text-secondary); }
  .history-boundary { position: relative; z-index: 5; display: grid; gap: 3px; justify-items: center; margin: 0 0 14px; color: var(--pi-muted); font-size: 12px; text-align: center; }
  .history-load-button { color: var(--pi-text-secondary); }
  .queued-messages { --ui-transcript-bg: color-mix(in srgb, var(--pi-warning) 5%, var(--pi-bg)); max-width: 100%; min-width: 0; display: grid; gap: 8px; margin: 0 0 12px; padding: 12px 16px; color: var(--pi-text); overflow: hidden; }
  .queued-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .queued-heading { min-width: 0; flex: 1 1 180px; display: grid; gap: 2px; }
  .queued-heading strong { color: var(--pi-warning); }
  .queued-heading small { color: var(--pi-muted); }
  .queued-clear-button { color: var(--pi-warning); }
  .queued-message { display: grid; gap: 4px; padding-top: 8px; border-top: 1px solid var(--pi-border); }
  .queued-message:first-of-type { padding-top: 0; border-top: 0; }
  .queued-message-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
  .queued-message-actions { flex-wrap: wrap; }
  .queued-action .prompt-action-icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .queued-message-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
  .queued-attachments { display: inline-flex; align-items: center; gap: 4px; color: var(--pi-text-secondary); font-size: 12px; }
  .queued-kind { color: var(--pi-muted); font-size: 12px; text-transform: uppercase; }
  .queued-dialogs { margin: -8px 0 14px; padding: 0 4px; color: var(--pi-muted); font-size: 12px; text-align: center; }
  .suggested-input { --ui-transcript-bg: color-mix(in srgb, var(--pi-surface) 40%, var(--pi-bg)); display: grid; gap: 8px; margin: 0 0 12px; padding: 12px 16px; }
  .suggested-input-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .suggested-input-text { max-height: 12em; overflow: auto; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .suggested-input small { color: var(--pi-muted); }
  .suggested-input-use { justify-self: start; }
  .suggested-input-dismiss { font-size: 18px; }
  .session-activity { --ui-transcript-bg: color-mix(in srgb, var(--pi-surface) 40%, var(--pi-bg)); max-width: 100%; min-width: 0; display: grid; gap: 4px; margin: 0 0 12px; padding: 12px 16px; color: var(--pi-text); overflow: hidden; }
  .session-activity.compacting { --ui-transcript-bg: color-mix(in srgb, var(--pi-purple) 5%, var(--pi-bg)); }
  .session-activity strong { color: var(--pi-purple); }
  .session-activity span, .session-activity small { color: var(--pi-muted); }
  .history-boundary small { color: var(--pi-dim); }
  .msg-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 32px; margin-bottom: 4px; }
  /* Let the first lines use the space beside actions without covering message text. */
  .msg-header.conversation-header { float: inline-end; margin: -4px 0 4px 12px; max-width: calc(100% - 12px); }
  .msg-header.conversation-header .msg-header-trailing { flex-wrap: wrap; }
  .msg-header.conversation-header .msg-actions { flex-wrap: wrap; flex-shrink: 1; }
  .conversation-header ~ .part:not(formatted-text) { clear: both; }
  .msg-header-trailing { min-width: 0; flex: 1 1 auto; display: inline-flex; align-items: stretch; justify-content: flex-end; gap: 0; }
  .msg-actions { flex: 0 0 auto; }
  .msg-action { font-size: 14px; }
  .msg-action:disabled { opacity: .45; cursor: not-allowed; }
  .msg-fork-icon { font-size: 17px; }
  .label { display: block; color: var(--pi-muted); font-size: 12px; font-weight: 400; }
  .msg-header .label { min-width: 0; margin: 0; overflow-wrap: anywhere; }
  .msg-header-trailing { opacity: .8; transition: opacity .12s ease; }
  .msg:hover > .msg-header .msg-header-trailing, .msg:focus-within > .msg-header .msg-header-trailing, .group-msg:hover > .msg-header .msg-header-trailing, .group-msg:focus-within > .msg-header .msg-header-trailing, .msg-header-trailing:has(.msg-meta[aria-expanded="true"]) { opacity: 1; }
  @media (hover: none), (pointer: coarse) {
    .msg-header-trailing { opacity: 1; }
  }
  .msg-meta[aria-expanded="true"] { background: var(--pi-surface-hover); color: var(--pi-text); }
  .msg-info-icon { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .msg-meta-details { clear: both; min-width: 0; padding: 6px 0; color: var(--pi-muted); font: 12px/18px system-ui, sans-serif; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
  formatted-text.part { display: block; }
  formatted-text.part, .queued-message formatted-text { text-align: start; unicode-bidi: plaintext; }
  .part { max-width: 100%; min-width: 0; box-sizing: border-box; overflow: visible; overflow-wrap: anywhere; }
  .part + .part { margin-top: 10px; }
  .thinking { --ui-activity-tone: color-mix(in srgb, #4f83b3 70%, var(--pi-text) 30%); }
  .group-msg > .thinking { width: calc(100% + 24px); max-width: none; margin-inline: -12px; }
  .thinking-icon { flex: 0 0 auto; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; }
  .thinking > summary { font-weight: 600; }
  .tool-line > .ui-transcript-heading { font: 13px/20px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
  .tool-result.error { --ui-activity-tone: var(--pi-danger); }
  .tool-result.error > summary { color: color-mix(in srgb, var(--pi-danger) 65%, var(--pi-text) 35%); }
  .summary { color: var(--pi-text-secondary); margin-left: 6px; }
  .part:is(details):not(.ui-transcript-activity) { padding-top: 4px; }
  .part:is(details) > formatted-text { padding: 8px 12px 0; box-sizing: border-box; }
  .part.ui-transcript-activity > formatted-text { padding: 8px 12px 12px; }
  .part > formatted-text { display: block; max-width: 100%; min-width: 0; overflow: visible; }
  .skill-invocation, .skill-read { padding: 8px 0; }
  .skill-invocation > summary, .skill-read > strong { color: var(--pi-purple); }
  .skill-invocation > small, .skill-read > small { display: block; max-width: 100%; margin: 6px 0 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; white-space: nowrap; color: var(--pi-muted); direction: ltr; text-align: left; unicode-bidi: isolate; }
  summary { cursor: pointer; color: var(--pi-muted); }
  pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; direction: ltr; text-align: left; unicode-bidi: isolate; }
  .shell-output { color: var(--pi-text); font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; direction: ltr; text-align: left; unicode-bidi: isolate; }
  @keyframes pulse { 0%, 100% { transform: scale(.75); opacity: .55; } 50% { transform: scale(1.2); opacity: 1; } }
`;

export const formattedTextStyles = css`
  :host { display: block; }
  .formatted { white-space: normal; overflow-wrap: anywhere; line-height: 1.45; text-align: start; unicode-bidi: plaintext; }
  p, ul, ol, pre, blockquote, .table-scroll, .code-block-wrapper, .plain-code-block { margin: 0 0 10px; }
  :is(p, ul, ol, pre, blockquote, .table-scroll, .code-block-wrapper, .plain-code-block):last-child { margin-bottom: 0; }
  /* Full-width blocks must start below any adjacent transcript controls. */
  pre, blockquote, .table-scroll, .code-block-wrapper, .plain-code-block { clear: both; }
  .plain-code-block { white-space: pre-wrap; }
  ul, ol { padding-left: 22px; }
  li + li { margin-top: 3px; }
  code { border: 0; border-radius: 3px; background: var(--pi-surface-hover); padding: 1px 4px; font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; direction: ltr; text-align: left; unicode-bidi: isolate; }
  .code-block-wrapper > :is(pre, .plain-code-block) { margin: 0; padding: 12px; border: 0; border-radius: 0 0 7px 7px; background: transparent; }
  pre { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); padding: 10px; white-space: pre-wrap; overflow: visible; direction: ltr; text-align: left; unicode-bidi: isolate; }
  .code-blocks-scroll :is(pre, .plain-code-block) { white-space: pre; overflow-wrap: normal; overflow-x: auto; overflow-y: hidden; }
  pre code { border: 0; padding: 0; background: transparent; }
  blockquote { border-left: 3px solid var(--formatted-muted-color, var(--pi-border)); padding-left: 10px; color: var(--formatted-muted-color, var(--pi-muted)); }
  img { max-width: 100%; height: auto; }
  a { color: var(--formatted-link-color, var(--pi-accent)); }
  h1, h2, h3, h4 { margin: 14px 0 8px; line-height: 1.2; }
  h1:first-child, h2:first-child, h3:first-child, h4:first-child { margin-top: 0; }
  h1 { font-size: 20px; }
  h2 { font-size: 17px; }
  h3 { font-size: 15px; }
  h4 { font-size: 14px; }
  .table-scroll { max-width: 100%; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
  .table-scroll:focus-visible { outline: 1px solid var(--pi-accent); outline-offset: 2px; }
  table { --formatted-table-bg: color-mix(in srgb, var(--pi-text) 4%, var(--ui-transcript-bg, var(--pi-bg))); border-collapse: collapse; width: max-content; min-width: 100%; max-width: none; background: var(--formatted-table-bg); }
  th, td { border: 1px solid var(--pi-border); padding: 4px 8px; max-width: 48ch; overflow-wrap: anywhere; }
  th { background: color-mix(in srgb, var(--pi-text) 4%, var(--formatted-table-bg)); }
`;

export const statusBarStyles = css`
  :host { display: block; color: var(--pi-muted); font: 12px system-ui, sans-serif; }
  .bar { display: flex; justify-content: flex-end; gap: 12px; align-items: center; min-width: 0; padding: 7px 12px; border-top: 1px solid var(--pi-border); background: var(--pi-bg); white-space: nowrap; overflow: hidden; }
  span { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .warning-toggle { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; margin-right: auto; border: 0; background: transparent; color: inherit; padding: 0; font: inherit; line-height: 1; white-space: nowrap; cursor: pointer; }
  .warning-toggle:focus-visible { outline: 1px solid currentColor; outline-offset: 2px; }
  .warning-toggle-icon { flex: 0 0 auto; width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .activity { display: inline-flex; align-items: center; gap: 6px; color: var(--pi-muted); }
  .activity.active { color: var(--pi-success); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .45; flex: 0 0 auto; }
  .activity.active .dot { animation: pulse 1s ease-in-out infinite; opacity: 1; }
  .muted { color: var(--pi-dim); }
  @keyframes pulse { 0%, 100% { transform: scale(.75); opacity: .55; } 50% { transform: scale(1.2); opacity: 1; } }
`;

export const autocompleteStyles = css`
  :host { display: block; }
  .menu { position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); z-index: 10; max-height: 260px; overflow: auto; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); box-shadow: 0 10px 30px var(--pi-shadow); }
  button { display: grid; grid-template-columns: minmax(120px, 1fr) auto; gap: 4px 10px; width: 100%; border: 0; border-bottom: 1px solid var(--pi-border); border-radius: 0; background: transparent; color: var(--pi-text); padding: 8px 10px; text-align: left; cursor: pointer; }
  button:last-child { border-bottom: 0; }
  button.selected, button:hover { background: var(--pi-selection-bg); }
  .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .argument-hint { color: var(--pi-muted); font-size: 12px; }
  .detail { color: var(--pi-muted); font-size: 12px; }
  small { grid-column: 1 / -1; color: var(--pi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

export const promptEditorStyles = css`
  ${uiButtonStyles}
  ${uiToolbarStyles}
  :host { position: relative; z-index: 5; display: block; color: var(--pi-text); font: 14px system-ui, sans-serif; }
  footer { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; padding: 0; border-top: 1px solid var(--pi-border); }
  footer.shell-mode { border-top-color: var(--pi-success); background: var(--pi-success-bg); }
  .editor-wrap { position: relative; min-width: 0; }
  .actions { justify-content: flex-end; flex-wrap: nowrap; white-space: nowrap; border-top: 1px solid var(--pi-border-muted); }
  .compact-status { display: flex; min-width: 0; align-items: stretch; flex: 1 1 0; }
  .compact-status > .ui-toolbar-group { flex: 0 1 auto; }
  .select-model { display: block; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: left; }
  .icon-button { flex: 0 0 auto; display: inline-grid; place-items: center; width: 36px; height: 36px; padding: 0; }
  .icon-button .prompt-action-icon, .icon-button .prompt-thinking-gauge { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .icon-button .prompt-action-icon-filled { fill: currentColor; stroke: none; }
  .default-send-action:not(:disabled), .default-send-action:hover:not(:disabled) { color: var(--pi-accent, var(--pi-text)); }
  .stop-button:not(:disabled), .stop-button:hover:not(:disabled) { color: var(--pi-danger); }
  .select-thinking .prompt-thinking-gauge .gauge-bar { fill: currentColor; stroke: none; opacity: .28; }
  .select-thinking .prompt-thinking-gauge .gauge-bar-active { opacity: 1; }
  .editor-attach { position: absolute; right: 8px; bottom: 8px; z-index: 2; width: 30px; height: 30px; }
  .editor-attach .prompt-action-icon { width: 16px; height: 16px; }
  textarea, .markdown-editor .cm-editor { box-sizing: border-box; width: 100%; min-height: 54px; max-height: 220px; resize: none; overflow: hidden; border-radius: 0; border: 0; background: var(--pi-bg); color: var(--pi-text); font: var(--pi-control-font-size, 16px)/1.4 var(--pi-control-font-family, system-ui, sans-serif); }
  textarea { overflow-y: auto; padding: 12px 16px; }
  textarea:focus-visible, .markdown-editor:focus-within { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
  .markdown-editor .cm-scroller { max-height: 220px; overflow-y: auto; font-family: var(--pi-control-font-family, system-ui, sans-serif); line-height: 1.4; }
  .markdown-editor .cm-content { min-height: 38px; padding: 12px 52px 12px 16px; caret-color: var(--pi-text); text-align: start; unicode-bidi: plaintext; }
  .markdown-editor .cm-line { padding: 0; unicode-bidi: plaintext; }
  .markdown-editor .cm-placeholder { color: var(--pi-dim); }
  .markdown-editor .prompt-placeholder::before { content: attr(data-placeholder); }
  .markdown-editor .cm-argument-hint { color: var(--pi-dim); pointer-events: none; }
  .markdown-editor .cm-focused { outline: none; }
  /* drawSelection() renders the caret and selection itself, and CodeMirror's
     base colors for them assume a light editor (black caret, pale selection).
     Re-theme them so they stay readable in every pi-web theme. The focused
     selection rule must outspecify CodeMirror's base rule for the focused
     selection background. */
  .markdown-editor .cm-cursor { border-left-color: var(--pi-text); }
  .markdown-editor .cm-editor .cm-selectionBackground { background: color-mix(in srgb, var(--pi-text) 18%, transparent); }
  .markdown-editor .cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground { background: color-mix(in srgb, var(--pi-accent) 32%, transparent); }
  .shell-mode textarea, .shell-mode .markdown-editor .cm-editor { background: var(--pi-success-bg); }
  .shell-mode textarea:focus-visible, .shell-mode .markdown-editor:focus-within { outline-color: var(--pi-success); }
  .mode-hint { position: absolute; right: 46px; bottom: 8px; max-width: calc(100% - 54px); border: 1px solid var(--pi-success-border); border-radius: 999px; background: var(--pi-success-surface); color: var(--pi-success); padding: 2px 8px; font-size: 12px; pointer-events: none; }
  .prompt-chips, .attachments { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 12px; }
  .prompt-chip { display: flex; align-items: center; gap: 6px; max-width: 100%; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); padding: 3px 6px; }
  .prompt-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prompt-chip button { flex: none; padding: 0 5px; }
  .chip-error { flex-basis: 100%; color: var(--pi-danger); font-size: 12px; }
  .attachment-chip { position: relative; width: 56px; height: 56px; border: 1px solid var(--pi-border); border-radius: 8px; overflow: hidden; background: var(--pi-bg); }
  .attachment-chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .attachment-chip-file { display: grid; place-items: center; }
  .attachment-file-preview { display: grid; place-items: center; width: 34px; height: 26px; border: 1px solid var(--pi-border-muted); border-radius: 4px; background: var(--pi-surface); color: var(--pi-muted); font: 700 10px/1 system-ui, sans-serif; letter-spacing: .03em; }
  .attachment-file-name { position: absolute; right: 4px; bottom: 3px; left: 4px; overflow: hidden; color: var(--pi-muted); font-size: 10px; line-height: 1.2; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
  .attachment-remove { position: absolute; top: 1px; right: 1px; width: 18px; height: 18px; padding: 0; line-height: 16px; border-radius: 50%; border: 1px solid var(--pi-border); background: var(--pi-surface); color: var(--pi-text); font-size: 13px; cursor: pointer; }
  .attachment-delivery select { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 5px 7px; font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); }
  .attachment-error { flex-basis: 100%; color: var(--pi-danger); font-size: 12px; }
  button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
  button:disabled, textarea:disabled, .markdown-editor-disabled .cm-editor { opacity: .5; cursor: not-allowed; }
  @media (max-width: 640px) {
    button { padding: 6px 8px; }
  }
  @media (max-width: 430px) {
    button { padding: 5px 7px; }
    .icon-button { width: 34px; height: 34px; }
  }
`;
