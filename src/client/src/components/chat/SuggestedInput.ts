import { html } from "lit";

export interface SuggestedInputOptions {
  text: string;
  onUse: () => void;
  onDismiss: (() => void) | undefined;
}

/** Stateless transcript content; draft replacement and suppression belong to the session owner. */
export function renderSuggestedInput({ text, onUse, onDismiss }: SuggestedInputOptions) {
  return html`
    <aside class="suggested-input ui-transcript-surface">
      <div class="suggested-input-header">
        <strong>Suggested input</strong>
        ${onDismiss === undefined ? null : html`
          <button type="button" class="suggested-input-dismiss ui-button ui-button--icon ui-button--compact" aria-label="Dismiss suggested input" title="Dismiss suggested input in this browser" @click=${onDismiss}>×</button>
        `}
      </div>
      <p class="suggested-input-text" dir="auto">${text === "" ? "Empty input" : text}</p>
      <small>Replaces your current draft. Nothing is sent.</small>
      <button type="button" class="suggested-input-use ui-button ui-button--primary" @click=${onUse}>Use suggested input</button>
    </aside>
  `;
}
