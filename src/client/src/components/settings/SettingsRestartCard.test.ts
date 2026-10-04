// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiWebRestartAvailability, PiWebRuntimeResponse } from "../../api";
import { HttpRequestError } from "../../api/http";
import { RESTART_CONFIRMATION, SettingsRestartCard, type PiWebRestartClient } from "./SettingsRestartCard";

function runtime(sessiondAvailable: boolean): PiWebRuntimeResponse {
  const component = (available: boolean) => ({ component: "web" as const, label: "x", available, capabilities: [] });
  return { packageName: "pi-web", generatedAt: "now", capabilities: [], components: { web: component(true), sessiond: { ...component(sessiondAvailable), component: "sessiond" } } };
}

function fakeClient(availability: PiWebRestartAvailability | Error = { available: true, token: "old" }) {
  const restartAvailability = vi.fn<PiWebRestartClient["restartAvailability"]>(() => availability instanceof Error ? Promise.reject(availability) : Promise.resolve(availability));
  const restart = vi.fn<PiWebRestartClient["restart"]>(() => Promise.resolve({ scheduled: true as const, delaySeconds: 3 }));
  const piWebRuntime = vi.fn<PiWebRestartClient["piWebRuntime"]>(() => Promise.resolve(runtime(true)));
  return { restartAvailability, restart, piWebRuntime };
}

async function mount(client: PiWebRestartClient, confirmed = true) {
  const card = new SettingsRestartCard();
  card.client = client;
  const confirmRestart = vi.fn(() => confirmed);
  const reloadPage = vi.fn();
  card.confirmRestart = confirmRestart;
  card.reloadPage = reloadPage;
  document.body.append(card);
  await vi.advanceTimersByTimeAsync(0);
  await card.updateComplete;
  const button = () => {
    const found = card.shadowRoot?.querySelector("button");
    if (!(found instanceof HTMLButtonElement)) throw new Error("missing restart button");
    return found;
  };
  const text = () => card.shadowRoot?.textContent ?? "";
  return { card, button, text, confirmRestart, reloadPage };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("settings-restart-card", () => {
  it("makes no POST when the confirmation is canceled and keeps the button usable", async () => {
    const client = fakeClient();
    const { button, confirmRestart } = await mount(client, false);

    button().click();
    await vi.advanceTimersByTimeAsync(0);

    expect(confirmRestart).toHaveBeenCalledWith(RESTART_CONFIRMATION);
    expect(RESTART_CONFIRMATION).toContain("not the selected remote machine");
    expect(RESTART_CONFIRMATION).toContain("ALL active sessions and background jobs on this server");
    expect(client.restart).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
  });

  it("sends the token once, blocks duplicate clicks, and reloads only after a new token and available daemon", async () => {
    const client = fakeClient();
    const { card, button, text, reloadPage } = await mount(client);
    const polls: PiWebRestartAvailability[] = [{ available: true, token: "old" }, { available: true, token: "new" }, { available: true, token: "new" }];
    client.restartAvailability.mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch")));
    for (const poll of polls) client.restartAvailability.mockImplementationOnce(() => Promise.resolve(poll));
    client.piWebRuntime.mockResolvedValueOnce(runtime(false));

    button().click();
    button().click();
    await vi.advanceTimersByTimeAsync(0);
    await card.updateComplete;

    expect(client.restart).toHaveBeenCalledTimes(1);
    expect(client.restart).toHaveBeenCalledWith("old");
    expect(button().disabled).toBe(true);
    expect(text()).toContain("Restarting PI WEB…");

    await vi.advanceTimersByTimeAsync(3000);
    await card.updateComplete;
    expect(text()).toContain("Reconnecting to PI WEB…");
    await vi.advanceTimersByTimeAsync(2000);
    expect(client.piWebRuntime).toHaveBeenCalledTimes(1);
    expect(reloadPage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(client.piWebRuntime).toHaveBeenCalledTimes(2);
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(client.restart).toHaveBeenCalledTimes(1);
  });

  it("shows a scheduling failure and allows retrying", async () => {
    const client = fakeClient();
    client.restart.mockRejectedValueOnce(new HttpRequestError("systemd-run failed", 500));
    const { card, button, text } = await mount(client);

    button().click();
    await vi.advanceTimersByTimeAsync(0);
    await card.updateComplete;

    expect(text()).toContain("Restart was not scheduled: systemd-run failed");
    expect(button().disabled).toBe(false);
  });

  it("disables the button with the server reason or for older servers", async () => {
    const unavailable = await mount(fakeClient({ available: false, reason: "Not running under systemd" }));
    expect(unavailable.button().disabled).toBe(true);
    expect(unavailable.text()).toContain("Not running under systemd");
    document.body.replaceChildren();

    const old = await mount(fakeClient(new HttpRequestError("Not Found", 404)));
    expect(old.button().disabled).toBe(true);
    expect(old.text()).toContain("does not support restarting from the UI");
  });

  it("bounds stalled reads, aborts them, and stops reconnecting at the deadline", async () => {
    const client = fakeClient();
    const { card, button, text, reloadPage } = await mount(client);
    const signals: AbortSignal[] = [];
    client.restartAvailability.mockImplementation((signal) => {
      if (signal !== undefined) signals.push(signal);
      return new Promise(() => { /* Simulate a network request that never settles. */ });
    });

    button().click();
    await vi.advanceTimersByTimeAsync(3000 + 90_000 + 10_000);
    await card.updateComplete;
    const attempts = client.restartAvailability.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(signals.length).toBeGreaterThan(1);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(client.restartAvailability.mock.calls.length).toBe(attempts);
    expect(text()).toContain("Refresh the page manually");
    expect(reloadPage).not.toHaveBeenCalled();
    expect(client.restart).toHaveBeenCalledTimes(1);
  });

  it("stops polling after the bounded timeout and asks for a manual refresh", async () => {
    const client = fakeClient();
    const { card, text, button, reloadPage } = await mount(client);

    button().click();
    await vi.advanceTimersByTimeAsync(3000 + 90_000 + 1000);
    await card.updateComplete;
    const pollsAtTimeout = client.restartAvailability.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(reloadPage).not.toHaveBeenCalled();
    expect(text()).toContain("Refresh the page manually");
    expect(client.restartAvailability.mock.calls.length).toBe(pollsAtTimeout);
    expect(client.restart).toHaveBeenCalledTimes(1);
  });
});
