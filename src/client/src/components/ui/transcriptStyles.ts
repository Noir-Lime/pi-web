import { css } from "lit";

/** Flat transcript sections; consumers own layout and choose an opaque sticky-header tone. */
export const uiTranscriptStyles = css`
  .ui-transcript-surface { box-sizing: border-box; border: 0; border-radius: 0; background: var(--ui-transcript-bg, transparent); }
  .ui-transcript-disclosure { box-sizing: border-box; display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 6px 12px; line-height: 20px; border: 0; border-radius: 0; background: var(--ui-transcript-heading-bg, transparent); cursor: pointer; list-style: none; }
  .ui-transcript-disclosure::-webkit-details-marker { display: none; }
  /* Empty generated markers preserve the native summary name and avoid font-dependent glyphs. */
  .ui-transcript-disclosure::before { content: ""; flex: 0 0 auto; width: 0; height: 0; border-block: 4px solid transparent; border-inline-start: 5px solid currentColor; border-inline-end: 3px solid transparent; }
  details[open] > .ui-transcript-disclosure::before { border-block-start: 5px solid currentColor; border-block-end: 3px solid transparent; border-inline: 4px solid transparent; }
  .ui-transcript-disclosure:hover { background: var(--pi-surface-hover); }
  .ui-transcript-disclosure:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
  @media (pointer: coarse) {
    .ui-transcript-disclosure { min-height: 44px; padding-block: 12px; }
  }
`;
