import { css } from "lit";

/** Flat configuration groups; controls and persistence stay with the consumer. */
export const uiSettingsStyles = css`
  .ui-settings-section { display: grid; gap: 14px; min-width: 0; padding: 16px; border-bottom: 1px solid var(--pi-border-muted); }
  .ui-settings-heading { display: grid; gap: 6px; min-width: 0; }
  .ui-settings-heading h3 { margin: 0; font-size: 14px; line-height: 1.4; }
  .ui-settings-heading p { margin: 0; color: var(--pi-muted); line-height: 1.45; }
  .ui-settings-fields { display: grid; gap: 14px; min-width: 0; }
  .ui-settings-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; min-width: 0; }
  .ui-settings-path { display: grid; gap: 5px; min-width: 0; padding: 12px; background: var(--pi-bg); color: var(--pi-muted); overflow-wrap: anywhere; }
  .ui-settings-summary { display: grid; gap: 10px; min-width: 0; padding: 12px; background: var(--pi-bg); }
  .ui-settings-list { display: grid; gap: 0; min-width: 0; }
  .ui-settings-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-width: 0; padding: 12px 16px; border-bottom: 1px solid var(--pi-border-muted); }
  @media (max-width: 480px) {
    .ui-settings-actions { display: grid; grid-template-columns: minmax(0, 1fr); }
  }
`;

/** Status feedback independent of settings layout and modal placement. */
export const uiNoticeStyles = css`
  .ui-notice { min-width: 0; padding: 12px 16px; border-inline-start: 3px solid var(--pi-border); background: var(--pi-surface); line-height: 1.45; overflow-wrap: anywhere; }
  .ui-notice.error { border-color: var(--pi-danger); color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-surface)); }
  .ui-notice.success { border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-surface); }
  .ui-notice.warning { border-color: var(--pi-warning-border); color: var(--pi-text); background: var(--pi-warning-surface); }
  .ui-notice.info { color: var(--pi-muted); }
`;
