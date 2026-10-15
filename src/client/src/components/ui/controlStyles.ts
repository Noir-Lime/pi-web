import { css } from "lit";

/** Native controls keep their own events, focus, disabled state, and form semantics. */
export const uiButtonStyles = css`
  .ui-button, .ui-menu-item {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
    min-height: var(--ui-control-size, 44px);
    padding: var(--ui-control-padding, 10px 12px);
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--pi-muted);
    font: 12px/20px system-ui, sans-serif;
    text-decoration: none;
    text-transform: none;
    cursor: pointer;
  }
  .ui-button--compact { --ui-control-size: 32px; --ui-control-padding: 6px 10px; }
  .ui-button--icon { flex: 0 0 auto; min-width: var(--ui-control-size, 44px); padding-inline: 0; font-size: 16px; }
  .ui-button:hover:not(:disabled), .ui-menu-item:hover:not(:disabled):not(:has(input:disabled)) {
    background: var(--pi-surface-hover);
    color: var(--pi-text);
  }
  .ui-button[aria-pressed="true"], .ui-button.selected {
    background: var(--pi-selection-bg);
    color: var(--pi-text);
  }
  .ui-button--primary { background: var(--pi-selection-bg); color: var(--pi-accent); font-weight: 600; }
  .ui-button--primary:hover:not(:disabled) { background: var(--pi-selection-bg); color: var(--pi-text-bright); }
  .ui-button.danger, .ui-menu-item.danger { color: var(--pi-danger); }
  .ui-button.danger:hover:not(:disabled), .ui-menu-item.danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--pi-danger) 14%, transparent);
  }
  .ui-button:focus-visible, .ui-menu-item:focus-visible, .ui-menu-item:has(input:focus-visible) {
    outline: 2px solid var(--pi-accent);
    outline-offset: -2px;
  }
  .ui-button:disabled, .ui-menu-item:disabled, .ui-menu-item:has(input:disabled) { opacity: .5; cursor: not-allowed; }
  @media (pointer: coarse) {
    .ui-button, .ui-menu-item { min-height: max(44px, var(--ui-control-size, 44px)); }
    .ui-button--icon { min-width: max(44px, var(--ui-control-size, 44px)); }
  }
`;

/** A compact secondary control group; spacing belongs to its controls, not gaps. */
export const uiToolbarStyles = css`
  .ui-toolbar {
    --ui-control-size: 32px;
    --ui-control-padding: 6px 10px;
    display: flex;
    align-items: stretch;
    gap: 0;
    min-width: 0;
    min-height: 32px;
    padding: 0;
  }
  .ui-toolbar-title { flex: 1 1 auto; min-width: 0; justify-content: space-between; text-align: left; font: inherit; color: inherit; text-transform: inherit; }
  .ui-toolbar-group { flex: 0 0 auto; display: flex; align-items: stretch; gap: 0; }
  .ui-toolbar-group > .ui-button + .ui-button, .ui-toolbar > .ui-button + .ui-button { border-inline-start: 1px solid var(--pi-border-muted); }
  .ui-toolbar > .ui-toolbar-group { border-inline-start: 1px solid var(--pi-border-muted); }
`;

/** A popup surface, not an ARIA menu: keyboard behavior remains with its owner. */
export const uiMenuStyles = css`
  .ui-menu {
    --ui-control-size: 32px;
    --ui-control-padding: 6px 10px;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    width: max-content;
    max-width: 100%;
    overflow: auto;
    padding: 0;
    border: 1px solid var(--pi-border);
    border-radius: 6px;
    background: var(--pi-surface);
    color: var(--pi-text);
    box-shadow: 0 8px 24px var(--pi-shadow);
  }
  .ui-menu .ui-menu-item { width: 100%; justify-content: flex-start; color: var(--pi-text); text-align: left; white-space: normal; overflow-wrap: anywhere; }
  .ui-menu .ui-menu-item.danger { color: var(--pi-danger); }
  .ui-menu .ui-menu-item + .ui-menu-item { box-shadow: inset 0 1px var(--pi-border-muted); }
  .ui-menu .ui-menu-item:has(input[type="checkbox"]) { justify-content: space-between; gap: 12px; }
  .ui-menu-item input { flex: 0 0 auto; margin: 0; accent-color: var(--pi-accent); cursor: inherit; }
`;
