import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";
import "./SettingsPanelFrame";
import type { SettingsNotice } from "./SettingsPanelFrame";
import { askUserConfigPatch, spawnSessionsConfigPatch, subsessionsConfigPatch } from "./settingsSessiondConfig";

@customElement("settings-sessiond-panel")
export class SettingsSessiondPanel extends LitElement {
  @property({ attribute: false }) configResponse: PiWebConfigResponse | undefined;
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) saving = false;
  @property() error = "";
  @property() savedMessage = "";
  @property() targetLabel = "local (local gateway)";
  @property({ attribute: false }) onReload?: () => void | Promise<void>;
  @property({ attribute: false }) onSave?: (config: PiWebConfigValues) => void | Promise<void>;

  override render(): TemplateResult {
    const config = this.configResponse;
    const spawnOverridden = config?.envOverrides.spawnSessions === true;
    // On by default: the effective config is the source of truth for the toggle
    // state, so an unset config file still shows the feature as enabled.
    const effectiveSpawn = config?.effectiveConfig.spawnSessions !== false;
    const subsessionsOverridden = config?.envOverrides.subsessions === true;
    // On by default; also requires spawn to be enabled.
    const effectiveSubsessions = config?.effectiveConfig.subsessions === true && effectiveSpawn;
    const askUserOverridden = config?.envOverrides.askUser === true;
    const effectiveAskUser = config?.effectiveConfig.askUser === true;
    return html`
      <settings-panel-frame
        heading="Session daemon"
        .description=${sessiondDescription(this.targetLabel)}
        actionLabel="Refresh settings"
        .actionDisabled=${this.loading || this.saving}
        .notices=${this.panelNotices()}
        .onAction=${this.onReload}
      >
        ${config === undefined ? this.renderUnavailableConfigState() : html`
          <div class="config-path-card">
            <span>Config file</span>
            <code>${config.path}</code>
          </div>
          <div class="field">
            <label class="toggle">
              <input
                type="checkbox"
                id="spawn-sessions"
                aria-describedby="spawn-sessions-help"
                .checked=${live(effectiveSpawn)}
                ?disabled=${this.loading || this.saving || spawnOverridden}
                @change=${(event: Event) => { void this.toggleSpawnSessions(event); }}
              >
              <span>Allow agents to start sessions</span>
            </label>
            <small id="spawn-sessions-help">
              Agents can start sessions in any workspace of the same registered project with <code>spawn_session</code>.
              ${spawnOverridden ? html`Read-only because <code>PI_WEB_SPAWN_SESSIONS</code> overrides this setting. Change or remove it in the daemon environment to edit here.` : null}
            </small>
          </div>
          <div class="field">
            <label class="toggle">
              <input
                type="checkbox"
                id="subsessions"
                aria-describedby="subsessions-help"
                .checked=${live(effectiveSubsessions)}
                ?disabled=${this.loading || this.saving || subsessionsOverridden || !effectiveSpawn}
                @change=${(event: Event) => { void this.toggleSubsessions(event); }}
              >
              <span>Allow agents to track child sessions</span>
            </label>
            <small id="subsessions-help">
              Agents can start child sessions, check progress, and receive completion notifications with <code>spawn_subsession</code>, <code>list_subsessions</code>, <code>check_subsession</code>, and <code>read_subsession</code>.
              ${!effectiveSpawn ? html`Enable “Allow agents to start sessions” first.` : html`Requires “Allow agents to start sessions”.`}
              ${subsessionsOverridden ? html`Read-only because <code>PI_WEB_SUBSESSIONS</code> overrides this setting. Change or remove it in the daemon environment to edit here.` : null}
            </small>
          </div>
          <div class="field">
            <label class="toggle">
              <input
                type="checkbox"
                id="ask-user"
                aria-describedby="ask-user-help"
                .checked=${live(effectiveAskUser)}
                ?disabled=${this.loading || this.saving || askUserOverridden}
                @change=${(event: Event) => { void this.toggleAskUser(event); }}
              >
              <span>Allow agents to ask you questions</span>
            </label>
            <small id="ask-user-help">
              Agents can show a question form and wait for your answers with <code>ask_user</code>.
              ${askUserOverridden ? html`Read-only because <code>PI_WEB_ASK_USER</code> overrides this setting. Change or remove it in the daemon environment to edit here.` : null}
            </small>
          </div>
          <section class="effective-card" aria-labelledby="restart-summary-heading" aria-describedby="restart-summary-help">
            <h3 id="restart-summary-heading">After the next daemon restart</h3>
            <small id="restart-summary-help">Saved settings with environment overrides applied. This does not show the running daemon’s active settings.</small>
            <dl>
              <div><dt>Spawn sessions</dt><dd>${effectiveSpawn ? "Enabled" : html`<span class="muted">Disabled</span>`}</dd></div>
              <div><dt>Subsessions</dt><dd>${effectiveSubsessions ? "Enabled" : html`<span class="muted">Disabled</span>`}</dd></div>
              <div><dt>Ask questions</dt><dd>${effectiveAskUser ? "Enabled" : html`<span class="muted">Disabled</span>`}</dd></div>
            </dl>
          </section>
        `}
      </settings-panel-frame>
    `;
  }

  private panelNotices(): readonly SettingsNotice[] {
    return sessiondPanelNotices({
      error: this.error,
      savedMessage: this.savedMessage,
    });
  }

  private renderUnavailableConfigState(): TemplateResult {
    return html`<div class="loading-card">${this.loading ? "Loading configuration…" : "Configuration is unavailable. Refresh settings to try again."}</div>`;
  }

  private async toggleSpawnSessions(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    await this.onSave?.(spawnSessionsConfigPatch(enabled));
  }

  private async toggleSubsessions(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    await this.onSave?.(subsessionsConfigPatch(enabled));
  }

  private async toggleAskUser(event: Event): Promise<void> {
    const enabled = event.target instanceof HTMLInputElement && event.target.checked;
    await this.onSave?.(askUserConfigPatch(enabled));
  }

  static override styles = css`
    :host { display: block; }
    h3 { margin: 0; font-size: 13px; line-height: 1.3; }
    .loading-card, .config-path-card, .effective-card { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
    .loading-card { color: var(--pi-muted); }
    .config-path-card { display: grid; gap: 5px; }
    .config-path-card span, dt { color: var(--pi-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    code { border: 1px solid var(--pi-border-muted); border-radius: 5px; background: var(--pi-bg); padding: 1px 4px; color: var(--pi-text); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .field { display: grid; gap: 7px; }
    .field small, .effective-card small { color: var(--pi-muted); line-height: 1.45; }
    .toggle { display: flex; align-items: center; gap: 9px; cursor: pointer; }
    .toggle input { width: 16px; height: 16px; }
    .toggle input:disabled { cursor: not-allowed; }
    .effective-card { display: grid; gap: 10px; }
    .effective-card dl { display: grid; gap: 8px; margin: 0; }
    .effective-card dl > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; align-items: baseline; }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .muted { color: var(--pi-muted); }

    @media (max-width: 760px) {
      .effective-card dl > div { grid-template-columns: minmax(0, 1fr); gap: 3px; }
    }
  `;
}

export function sessiondDescription(targetLabel: string): string {
  return `Choose what agents can do on ${targetLabel}. Changes save immediately and take effect after that machine’s session daemon restarts. Restarting interrupts active sessions and running work.`;
}

export interface SessiondPanelNoticeContext {
  readonly error: string;
  readonly savedMessage: string;
}

/**
 * Compute the session-daemon panel's notice stack (error, then saved
 * confirmation) as a pure, publicly testable seam so tests assert the dynamic
 * notice logic and ordering here instead of scraping rendered `TemplateResult`
 * internals.
 */
export function sessiondPanelNotices(context: SessiondPanelNoticeContext): readonly SettingsNotice[] {
  const notices: SettingsNotice[] = [];
  if (context.error !== "") notices.push({ type: "error", content: context.error });
  if (context.savedMessage !== "") notices.push({ type: "success", content: context.savedMessage });
  return notices;
}
