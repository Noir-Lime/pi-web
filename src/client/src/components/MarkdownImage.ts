import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { TransientChoiceMemory } from "../formatting/transientChoiceMemory";
import "./ImagePresentation";

const shownImageMemory = new TransientChoiceMemory<true>();

/** An outside-workspace URL stays inert until the user chooses to load it. */
@customElement("pi-web-markdown-image")
export class MarkdownImage extends LitElement {
  @property({ attribute: "preview-url" }) previewUrl = "";
  @property() path = "";
  @property() description = "";
  @property({ attribute: "intent-key" }) intentKey: string | undefined;
  @property({ type: Boolean }) outside = false;
  @property({ type: Boolean, attribute: "loading-disabled" }) loadingDisabled = false;
  @state() private approved = false;

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("previewUrl") || changed.has("intentKey") || changed.has("outside")) {
      this.approved = this.outside && this.intentKey !== undefined
        && shownImageMemory.read(this.intentKey, this.previewUrl) === true;
    }
  }

  private showImage(): void {
    if (this.loadingDisabled || !this.outside || this.previewUrl === "") return;
    this.approved = true;
    if (this.intentKey !== undefined) shownImageMemory.choose(this.intentKey, this.previewUrl, true);
  }

  override render() {
    return html`<pi-web-image-presentation
      .source=${!this.loadingDisabled && this.previewUrl !== "" && (!this.outside || this.approved) ? this.previewUrl : undefined}
      .requestDisabled=${this.loadingDisabled || !this.outside || this.previewUrl === ""}
      .pendingLabel=${this.loadingDisabled ? "Image loading disabled" : "Show image"}
      .description=${this.description} .label=${this.path}
      @image-request=${() => { this.showImage(); }}
    ></pi-web-image-presentation>`;
  }

  static override styles = css`
    :host { display: inline-block; max-width: 100%; vertical-align: middle; }
  `;
}
