import { stylesheetIntegrationCapability } from "../plugins/styles";
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "./ModalSurface";
import { uiDialogStyles, uiFormStyles } from "./ui/dialogStyles";

/** Whether Save is allowed: the text must differ from the original and contain something. */
export function canSaveMessageEdit(original: string, draft: string): boolean {
  return draft !== original && draft.trim() !== "";
}

@customElement("message-edit-dialog")
export class MessageEditDialog extends LitElement {
  constructor() {
    super();
    stylesheetIntegrationCapability.createController(this);
  }

  @property() initialText = "";
  /** Saves the exact draft text. A rejection keeps the dialog open with the draft intact. */
  @property({ attribute: false }) onSave?: (text: string) => Promise<void>;
  @property({ attribute: false }) onCancel?: () => void;

  @state() private draft: string | undefined;
  @state() private saving = false;
  @state() private error = "";

  private get text(): string {
    return this.draft ?? this.initialText;
  }

  private async save(): Promise<void> {
    const text = this.text;
    if (this.saving || !canSaveMessageEdit(this.initialText, text)) return;
    this.saving = true;
    this.error = "";
    try {
      await this.onSave?.(text);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (this.isConnected) this.saving = false;
    }
  }

  private cancel(): void {
    if (!this.saving) this.onCancel?.();
  }

  override render() {
    return html`
      <modal-surface
        .onClose=${() => { this.cancel(); }}
        .busy=${this.saving}
        .initialFocus=${"textarea[name='text']"}
        .label=${"Edit message"}
      >
        <form class="ui-form" @submit=${(event: SubmitEvent) => { event.preventDefault(); void this.save(); }}>
          <header class="ui-dialog-header">
            <strong class="ui-dialog-title">Edit message</strong>
            <button class="ui-button ui-button--icon" type="button" ?disabled=${this.saving} @click=${() => { this.cancel(); }} aria-label="Close edit message">×</button>
          </header>
          <div class="ui-dialog-body ui-form-body">
            ${this.error === "" ? null : html`<div id="message-edit-error" class="ui-form-error" role="alert">${this.error}</div>`}
            <label class="ui-form-field">
              Message text
              <textarea name="text" rows="8" aria-describedby="message-edit-help" .value=${this.text} ?disabled=${this.saving} @input=${(event: InputEvent) => {
                if (event.target instanceof HTMLTextAreaElement) this.draft = event.target.value;
              }}></textarea>
            </label>
            <small id="message-edit-help" class="hint">Saving changes only this message. Later replies stay as they are, and no new response is generated.</small>
          </div>
          <footer class="ui-dialog-footer">
            <button class="ui-button" type="button" ?disabled=${this.saving} @click=${() => { this.cancel(); }}>Cancel</button>
            <button class="ui-button ui-button--primary" type="submit" ?disabled=${this.saving || !canSaveMessageEdit(this.initialText, this.text)}>${this.saving ? "Saving…" : "Save changes"}</button>
          </footer>
        </form>
      </modal-surface>
    `;
  }

  static override styles = [uiDialogStyles, uiFormStyles, css`
    :host { --ui-dialog-width: 640px; }
    textarea { box-sizing: border-box; width: 100%; min-height: 8em; resize: vertical; padding: 8px; font: inherit; color: inherit; background: var(--pi-input-bg, transparent); border: 1px solid var(--pi-border, currentColor); border-radius: 6px; white-space: pre-wrap; }
    .hint { color: var(--pi-muted); }
  `];
}
