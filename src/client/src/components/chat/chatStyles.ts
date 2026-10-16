import { css } from "lit";
import { uiButtonStyles, uiToolbarStyles } from "../ui/controlStyles";
import { uiTranscriptStyles } from "../ui/transcriptStyles";

export const chatStyles = css`
  ${uiButtonStyles}
  ${uiToolbarStyles}
  ${uiTranscriptStyles}
  :host { position: relative; z-index: 0; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; color: var(--pi-text); font: 14px system-ui, sans-serif; }
  .chat-wrap { --pi-chat-jump-size: 28px; position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  .top-notices { box-sizing: border-box; flex: 0 0 auto; max-height: 40%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg-overlay); }
  /* Empty notification hosts retain live regions without leaving a visible stack boundary. */
  .top-notices:not(:has(> .session-warnings)):has(> session-notification-tray[empty]) { border-bottom: 0; }
  .top-notices:has(> session-notification-tray[empty]) > .session-warnings { flex: 1 1 auto; max-height: 100%; border-bottom: 0; }
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
  .visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; border: 0 !important; }
  /* Contain sticky headers in the scroller's paint context, below its overlay scrollbar. */
  .chat { isolation: isolate; --pi-chat-conversation-bg: color-mix(in srgb, var(--pi-muted) 6%, var(--pi-bg)); --pi-chat-sticky-top: 0px; flex: 1 1 auto; min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; padding: 0; box-sizing: border-box; }
  .chat-jumps { position: absolute; right: 0; bottom: 0; z-index: 21; display: flex; gap: 0; background: var(--pi-bg-overlay); }
  .chat-jumps button { display: inline-grid; place-items: center; box-sizing: border-box; width: var(--pi-chat-jump-size); height: var(--pi-chat-jump-size); padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--pi-muted); font: 14px/1 system-ui, sans-serif; cursor: pointer; }
  .chat-jumps::before, .activity-dock::before { content: ""; position: absolute; inset: 0; border: 1px solid var(--pi-border-muted); border-bottom: 0; pointer-events: none; }
  .activity-dock::before { border-inline-end: 0; }
  .activity-dock + .chat-jumps::before { border-inline-start: 0; }
  .chat-jumps button.following { color: var(--pi-accent); }
  .chat-jumps button:hover, .chat-jumps button:focus-visible { color: var(--pi-text-bright); background: var(--pi-selection-bg); }
  .chat-jumps button:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
  .chat-wrap.plain .msg-header, .chat-wrap.plain .event-group > summary { position: static; top: auto; }
  .chat-wrap.plain *, .chat-wrap.plain *::before, .chat-wrap.plain *::after { transition: none !important; animation: none !important; box-shadow: none !important; text-shadow: none !important; filter: none !important; backdrop-filter: none !important; transform: none !important; border-radius: 0 !important; }
  .chat-wrap.plain .chat-image { --pi-image-radius: 0; }
  .activity-dock { position: absolute; right: calc(var(--pi-chat-jump-size) * 2); bottom: 0; z-index: 20; display: flex; align-items: center; gap: 4px; width: max-content; max-width: calc(100% - var(--pi-chat-jump-size) * 2); height: var(--pi-chat-jump-size); min-width: 0; box-sizing: border-box; border: 0; border-radius: 0; background: var(--pi-bg-overlay); color: var(--pi-muted); padding: 3px 6px; font-size: 11px; line-height: 16px; pointer-events: none; backdrop-filter: blur(6px); }
  .activity-dock.active .dot { color: var(--pi-success); }
  .activity-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: .45; flex: 0 0 auto; }
  .activity-dock.active .dot { width: 5px; height: 5px; animation: pulse 1s ease-in-out infinite; opacity: 1; }
  .msg { --ui-transcript-bg: var(--pi-bg); display: flow-root; max-width: 100%; min-width: 0; margin: 0; padding: 12px 16px 16px; overflow: visible; }
  .chat > .msg:last-child, .chat > .session-activity:last-child { margin-bottom: 0; }
  .msg.conversation-message { padding: 12px; --ui-transcript-bg: var(--pi-chat-conversation-bg); --formatted-link-color: color-mix(in srgb, var(--pi-accent) 45%, var(--pi-text) 55%); --formatted-muted-color: color-mix(in srgb, var(--pi-text-secondary) 80%, var(--pi-text) 20%); border-inline-start: 3px solid color-mix(in srgb, var(--pi-muted) 55%, var(--pi-border) 45%); padding-inline-start: 12px; }
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
  .group-msg { --ui-transcript-inset: 12px; display: flow-root; max-width: 100%; min-width: 0; padding: 8px var(--ui-transcript-inset); color: var(--pi-text); overflow: visible; }
  .group-msg.system { color: var(--pi-text-secondary); }
  .history-boundary { position: relative; z-index: 5; display: grid; gap: 3px; justify-items: center; margin: 0 0 14px; color: var(--pi-muted); font-size: 12px; text-align: center; }
  .history-load-button { color: var(--pi-text-secondary); }
  .queued-messages { --ui-transcript-bg: color-mix(in srgb, var(--pi-warning) 5%, var(--pi-bg)); max-width: 100%; min-width: 0; display: grid; gap: 8px; margin: 0; padding: 12px 16px; color: var(--pi-text); overflow: hidden; }
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
  /* Both columns set the row height; center content while actions stay at the top. */
  .msg.conversation-layout { display: grid; grid-template: "body actions" auto "meta meta" auto / minmax(0, 1fr) fit-content(50%); align-items: start; padding: 0; }
  .conversation-body { grid-area: body; min-width: 0; align-self: center; padding: 12px; }
  .conversation-layout > .msg-meta-details { grid-area: meta; padding: 12px; }
  .msg-header.conversation-header { grid-area: actions; min-width: 0; margin: 0; }
  .msg-header.conversation-header .msg-header-trailing { flex-wrap: wrap; }
  .msg-header.conversation-header .msg-actions { flex-wrap: wrap; flex-shrink: 1; }
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
  .group-msg > .thinking { width: calc(100% + 2 * var(--ui-transcript-inset)); max-width: none; margin-inline: calc(-1 * var(--ui-transcript-inset)); }
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
