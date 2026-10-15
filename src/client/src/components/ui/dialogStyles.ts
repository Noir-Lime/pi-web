import { css } from "lit";
import { uiButtonStyles } from "./controlStyles";

/** Content chrome for ModalSurface; focus trapping and dismissal stay with that component. */
export const uiDialogStyles = css`
  ${uiButtonStyles}
  :host { --ui-dialog-top: min(12dvh, 90px); --ui-dialog-bottom: max(16px, env(safe-area-inset-bottom)); position: fixed; inset: 0; z-index: var(--ui-dialog-z, 30); color: var(--pi-text); font: 14px system-ui, sans-serif; }
  modal-surface {
    --modal-surface-place-items: start center;
    --modal-surface-backdrop-padding: var(--ui-dialog-top) 16px var(--ui-dialog-bottom);
    --modal-surface-width: min(var(--ui-dialog-width, 720px), calc(100vw - 32px));
    --modal-surface-max-height: min(var(--ui-dialog-max-height, 640px), calc(100dvh - var(--ui-dialog-top) - var(--ui-dialog-bottom)));
  }
  .ui-dialog-header { flex: 0 0 auto; display: flex; align-items: stretch; min-width: 0; min-height: 44px; border-bottom: 1px solid var(--pi-border-muted); }
  .ui-dialog-title { box-sizing: border-box; flex: 1 1 auto; min-width: 0; align-self: center; margin: 0; padding: 12px 16px; font-size: 14px; line-height: 20px; font-weight: 600; overflow-wrap: anywhere; }
  .ui-dialog-header > .ui-button { flex: 0 0 auto; border-inline-start: 1px solid var(--pi-border-muted); }
  .ui-dialog-body { box-sizing: border-box; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; padding: 16px; }
  .ui-dialog-footer, .ui-form-actions { flex: 0 0 auto; display: flex; align-items: stretch; justify-content: flex-end; gap: 0; }
  .ui-dialog-footer { border-top: 1px solid var(--pi-border-muted); }
  .ui-dialog-footer > .ui-button + .ui-button, .ui-form-actions > .ui-button + .ui-button { border-inline-start: 1px solid var(--pi-border-muted); }
  .ui-dialog-search-row { flex: 0 0 auto; display: flex; align-items: stretch; min-width: 0; border-bottom: 1px solid var(--pi-border-muted); }
  .ui-dialog-search { box-sizing: border-box; flex: 1 1 auto; min-width: 0; min-height: 44px; width: 100%; margin: 0; padding: 10px 16px; border: 0; border-radius: 0; background: transparent; color: var(--pi-text); font: var(--pi-control-font-size, 16px)/1.5 var(--pi-control-font-family, system-ui, sans-serif); }
  .ui-dialog-search::placeholder { color: var(--pi-dim); }
  .ui-dialog-search:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
  .ui-dialog-search-row > .ui-button { flex: 0 0 auto; border-inline-start: 1px solid var(--pi-border-muted); }
`;

/** Gapless choices, including rows with a separate pin or checkbox action. */
export const uiSelectionStyles = css`
  .ui-selection-list { flex: 1 1 auto; min-height: 0; overflow: auto; }
  .ui-selection-list:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
  .ui-selection-option { box-sizing: border-box; display: block; width: 100%; min-height: 44px; padding: 10px 16px; color: var(--pi-text); font: 14px/20px system-ui, sans-serif; text-align: left; white-space: normal; overflow-wrap: anywhere; box-shadow: inset 0 -1px var(--pi-border-muted); }
  .ui-selection-row { display: flex; align-items: stretch; min-width: 0; box-shadow: inset 0 -1px var(--pi-border-muted); }
  .ui-selection-row > .ui-selection-option { flex: 1 1 auto; min-width: 0; width: auto; box-shadow: none; }
  /* Saved pin/default state is conveyed by the icon, not another selection surface. */
  .ui-selection-row > .ui-button--icon[aria-pressed="true"]:not(:hover) { background: transparent; }
  .ui-selection-row:hover, .ui-selection-option:hover:not(:disabled) { background: var(--pi-surface-hover); }
  .ui-selection-row.selected, .ui-selection-row:has(.ui-selection-option.selected), .ui-selection-option.selected, .ui-selection-option.selected:hover:not(:disabled) { background: var(--pi-selection-bg); }
  .ui-selection-detail { display: block; margin-top: 4px; color: var(--pi-muted); font-size: 12px; line-height: 18px; }
  .ui-dialog-empty { padding: 24px; color: var(--pi-muted); text-align: center; }
`;

/** The repeated form structure only; validation, copy, and submission stay local. */
export const uiFormStyles = css`
  .ui-form { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .ui-form-body { display: grid; align-content: start; gap: 12px; }
  .ui-form-field { display: grid; gap: 6px; min-width: 0; color: var(--pi-muted); }
  .ui-input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-bg); color: var(--pi-text); padding: 10px 12px; font: var(--pi-control-font-size, 16px)/1.4 var(--ui-input-font-family, var(--pi-control-font-family, system-ui, sans-serif)); }
  .ui-input:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
  .ui-input[aria-invalid="true"] { border-color: var(--pi-danger); }
  .ui-checkbox-field { box-sizing: border-box; display: flex; align-items: center; gap: 8px; min-height: 32px; color: var(--pi-text); cursor: pointer; }
  .ui-checkbox-field input { flex: 0 0 auto; margin: 0; accent-color: var(--pi-accent); }
  .ui-checkbox-field:has(input:focus-visible) { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
  .ui-form-error { border: 1px solid var(--pi-danger); border-radius: 6px; background: color-mix(in srgb, var(--pi-danger) 10%, transparent); color: var(--pi-danger); padding: 10px 12px; line-height: 1.4; overflow-wrap: anywhere; }
  @media (pointer: coarse) {
    .ui-checkbox-field { min-height: 44px; }
  }
`;
