import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import type { ImageDimensions } from "../../../shared/sessionMedia";

export interface ImageOpenDetail {
  src: string;
  alt: string;
}

/** The owner authorizes sources; the browser owns image loading and failure display. */
@customElement("pi-web-image-presentation")
export class ImagePresentation extends LitElement {
  @property({ attribute: false }) source: string | undefined;
  @property({ attribute: false }) dimensions: ImageDimensions | undefined;
  @property() description = "";
  @property() label = "";
  @property({ type: Boolean }) requestDisabled = false;
  @property() pendingLabel = "Show image";

  private requestImage(event: MouseEvent): void {
    if (this.requestDisabled) return;
    event.preventDefault();
    event.stopPropagation();
    this.dispatchEvent(new Event("image-request", { bubbles: true, composed: true }));
  }

  private open(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.source === undefined || this.source === "") return;
    this.dispatchEvent(new CustomEvent<ImageOpenDetail>("image-open", {
      detail: { src: this.source, alt: this.description }, bubbles: true, composed: true,
    }));
  }

  override render() {
    const pending = this.source === undefined || this.source === "";
    const dimensions = this.dimensions;
    return html`
      <div class="frame">
        <button class="placeholder" type="button" ?hidden=${!pending} ?disabled=${this.requestDisabled}
          @click=${(event: MouseEvent) => { this.requestImage(event); }}>
          <span>${this.pendingLabel}</span>${this.label === "" ? null : html`<code>${this.label}</code>`}
        </button>
        <button class="image-button" type="button" ?hidden=${pending} ?disabled=${pending}
          aria-label=${`Enlarge ${this.description || "image"}`} title="Click to enlarge"
          @click=${(event: MouseEvent) => { this.open(event); }}
          @keydown=${(event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") this.open(event); }}>
          <img loading="lazy" decoding="async" src=${pending ? nothing : this.source} alt=${this.description}
            width=${dimensions?.width ?? nothing} height=${dimensions?.height ?? nothing}
            style=${styleMap(dimensions === undefined ? {} : {
              "--image-width": `${String(dimensions.width)}px`,
              "--image-height": `${String(dimensions.height)}px`,
              "--image-ratio": String(dimensions.width / dimensions.height),
            })} />
        </button>
      </div>
    `;
  }

  static override styles = css`
    :host { display: block; max-width: 100%; min-width: 0; }
    .frame { max-width: 100%; }
    button { font: inherit; color: inherit; background: var(--pi-surface); border: 1px solid var(--pi-border, #888); border-radius: 4px; padding: .3em .65em; cursor: pointer; }
    button:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
    .placeholder { box-sizing: border-box; display: grid; align-content: center; justify-items: center; gap: .5em; width: 320px; max-width: 100%; min-height: 110px; padding: 1em; border: 1px dashed var(--pi-border, #888); border-radius: 4px; background: var(--pi-surface); text-align: center; }
    .placeholder:disabled { cursor: default; }
    code { display: block; max-width: 100%; margin: 0; overflow-wrap: anywhere; color: var(--pi-text-secondary); font-size: .85em; }
    .image-button { display: block; max-width: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
    [hidden] { display: none !important; }
    img { display: block; max-width: 100%; max-height: var(--pi-image-max-height, none); width: auto; height: auto; object-fit: contain; border-radius: var(--pi-image-radius, 0); }
    /* A definite width plus the declared ratio reserves the final, height-capped
       footprint before lazy loading. CSS still handles narrow viewports. */
    img[width][height] { width: min(var(--image-width), calc(var(--pi-image-max-height, var(--image-height)) * var(--image-ratio))); }
  `;
}
