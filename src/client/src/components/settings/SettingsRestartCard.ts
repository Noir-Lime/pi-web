import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { piWebApi } from "../../api";
import { HttpRequestError } from "../../api/http";

/** Subset of the PI WEB API the restart card uses; tests inject fakes. */
export type PiWebRestartClient = Pick<typeof piWebApi, "restartAvailability" | "restart" | "piWebRuntime">;

export const RESTART_RECONNECT_TIMEOUT_MS = 90_000;
export const RESTART_RECONNECT_INTERVAL_MS = 1_000;

export const RESTART_CONFIRMATION = [
  "Restart the PI WEB server serving this page?",
  "",
  "This restarts the current server, not the selected remote machine or workspace. ALL active sessions and background jobs on this server will be interrupted.",
  "The web server restarts first, then the session daemon, loading any installed updates. Interrupted work is not guaranteed to resume.",
].join("\n");

const UNSUPPORTED_REASON = "This PI WEB server does not support restarting from the UI (it may be an older version).";

type RestartPhase = "loading" | "idle" | "restarting" | "reconnecting";

/** Restart the serving PI WEB instance (web/API then session daemon) and reload once it is back. */
@customElement("settings-restart-card")
export class SettingsRestartCard extends LitElement {
  @property({ attribute: false }) client: PiWebRestartClient = piWebApi;
  @property({ attribute: false }) confirmRestart: (message: string) => boolean = (message) => window.confirm(message);
  @property({ attribute: false }) reloadPage: () => void = () => { window.location.reload(); };
  @state() private phase: RestartPhase = "loading";
  @state() private unavailableReason = "";
  @state() private error = "";
  private token: string | undefined;
  private connected = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.connected = true;
    void this.loadAvailability();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.connected = false;
  }

  override render(): TemplateResult {
    const busy = this.phase !== "idle";
    const disabled = busy || this.token === undefined;
    return html`
      <section class="settings-card" aria-label="Restart PI WEB server">
        <div class="card-heading">
          <h3>Restart PI WEB</h3>
          <p>Restarts the PI WEB server serving this page (not the selected remote machine), web server first and then the session daemon, to load installed updates. All active sessions and background jobs on this server are interrupted and may not resume.</p>
        </div>
        ${this.unavailableReason === "" ? null : html`<div class="message">${this.unavailableReason}</div>`}
        ${this.error === "" ? null : html`<div class="message error-message" role="alert">${this.error}</div>`}
        ${this.phase === "restarting" || this.phase === "reconnecting" ? html`<div class="message" role="status">${this.phase === "restarting" ? "Restarting PI WEB…" : "Reconnecting to PI WEB…"}</div>` : null}
        <footer class="form-actions">
          <button class="danger" ?disabled=${disabled} @click=${() => { void this.restart(); }}>${busy && this.phase !== "loading" ? "Restarting…" : "Restart PI WEB"}</button>
        </footer>
      </section>
    `;
  }

  private async loadAvailability(): Promise<void> {
    this.phase = "loading";
    try {
      const availability = await boundedRead((signal) => this.client.restartAvailability(signal), 10_000);
      this.token = availability.available ? availability.token : undefined;
      this.unavailableReason = this.token === undefined ? (availability.reason ?? UNSUPPORTED_REASON) : "";
    } catch (error) {
      this.token = undefined;
      this.unavailableReason = error instanceof HttpRequestError && error.status === 404 ? UNSUPPORTED_REASON : `Could not check restart support: ${errorMessage(error)}`;
    }
    this.phase = "idle";
  }

  private async restart(): Promise<void> {
    const token = this.token;
    if (this.phase !== "idle" || token === undefined) return;
    if (!this.confirmRestart(RESTART_CONFIRMATION)) return;
    this.phase = "restarting";
    this.error = "";
    let delaySeconds: number;
    try {
      delaySeconds = (await this.client.restart(token)).delaySeconds;
    } catch (error) {
      this.error = `Restart was not scheduled: ${errorMessage(error)}. Check the server and try again.`;
      this.phase = "idle";
      return;
    }
    await wait(delaySeconds * 1000);
    this.phase = "reconnecting";
    if (await this.waitForRestartedServer(token)) {
      this.reloadPage();
      return;
    }
    if (!this.connected) return;
    this.error = "PI WEB did not come back within 90 seconds. Refresh the page manually, or check the services and try again.";
    await this.loadAvailability();
  }

  /** Poll until a new web process (changed token) reports an available session daemon. */
  private async waitForRestartedServer(previousToken: string): Promise<boolean> {
    const deadline = Date.now() + RESTART_RECONNECT_TIMEOUT_MS;
    while (this.connected && Date.now() < deadline) {
      try {
        const ready = await boundedRead(async (signal) => {
          const availability = await this.client.restartAvailability(signal);
          if (availability.token === undefined || availability.token === previousToken) return false;
          const runtime = await this.client.piWebRuntime(signal);
          return runtime.components.sessiond.available;
        }, Math.min(5_000, deadline - Date.now()));
        if (ready && this.isConnected) return true;
      } catch {
        // Expected while the server is down; keep polling until the deadline.
      }
      await wait(Math.max(0, Math.min(RESTART_RECONNECT_INTERVAL_MS, deadline - Date.now())));
    }
    return false;
  }

  static override styles = css`
    :host { display: block; }
    .settings-card, .message { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
    .settings-card { display: grid; gap: 14px; }
    .card-heading { display: grid; gap: 6px; min-width: 0; }
    h3, p { margin: 0; }
    h3 { font-size: 13px; line-height: 1.3; }
    p, .message { color: var(--pi-muted); line-height: 1.45; }
    .error-message { border-color: var(--pi-danger); color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-surface)); }
    .form-actions { display: flex; justify-content: flex-end; }
    button { font: inherit; border: 1px solid var(--pi-danger); border-radius: 8px; background: var(--pi-surface); color: var(--pi-danger); padding: 7px 9px; cursor: pointer; }
    button:disabled { opacity: .55; cursor: not-allowed; }
  `;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Bound UI waits as well as canceling fetch, including on a black-holed connection.
async function boundedRead<T>(read: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Server request timed out"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([read(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
