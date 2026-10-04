import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PiWebRestartAvailability } from "../shared/apiTypes.js";
import { buildApp } from "./app.js";
import { createSystemdPiWebRestartBackend, type PiWebRestartAvailabilityResult, type PiWebRestartBackend } from "./piWebStatus.js";

function fakeRestart(availability: PiWebRestartAvailabilityResult = { available: true }, schedule = vi.fn(() => Promise.resolve())) {
  const backend: PiWebRestartBackend = { availability: () => Promise.resolve(availability), schedule };
  return { backend, schedule };
}

async function withApp({ backend }: { backend: PiWebRestartBackend }, test: (app: FastifyInstance) => Promise<void>): Promise<void> {
  const app = await buildApp({ piWebRestart: backend, clientDist: false, logger: false });
  try {
    await test(app);
  } finally {
    await app.close();
  }
}

async function restartToken(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "GET", url: "/api/pi-web/restart" });
  const token = response.json<PiWebRestartAvailability>().token;
  if (token === undefined) throw new Error("restart token missing");
  return token;
}

function post(app: FastifyInstance, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method: "POST", url: "/api/pi-web/restart", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, payload: JSON.stringify(payload) });
}

describe("PI WEB restart routes", () => {
  it("offers a token when restart is available, uncached", async () => {
    await withApp(fakeRestart(), async (app) => {
      const response = await app.inject({ method: "GET", url: "/api/pi-web/restart" });
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json<PiWebRestartAvailability>()).toMatchObject({ available: true });
      expect(typeof response.json<PiWebRestartAvailability>().token).toBe("string");
    });
  });

  it("reports the unavailable reason without a token", async () => {
    await withApp(fakeRestart({ available: false, reason: "not hosted" }), async (app) => {
      const response = await app.inject({ method: "GET", url: "/api/pi-web/restart" });
      expect(response.json()).toEqual({ available: false, reason: "not hosted" });
    });
  });

  it("schedules a confirmed same-origin request and returns a receipt", async () => {
    const restart = fakeRestart();
    await withApp(restart, async (app) => {
      const response = await post(app, { confirmed: true, token: await restartToken(app) });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ scheduled: true, delaySeconds: 3 });
      expect(restart.schedule).toHaveBeenCalledOnce();
    });
  });

  it("rejects missing or wrong tokens, missing confirmation, non-JSON and cross-site requests", async () => {
    const restart = fakeRestart();
    await withApp(restart, async (app) => {
      const token = await restartToken(app);
      expect((await post(app, { confirmed: true })).statusCode).toBe(403);
      expect((await post(app, { confirmed: true, token: `${token}x` })).statusCode).toBe(403);
      expect((await post(app, { token })).statusCode).toBe(400);
      expect((await post(app, { confirmed: "true", token })).statusCode).toBe(400);
      expect((await post(app, { confirmed: true, token }, { "sec-fetch-site": "cross-site" })).statusCode).toBe(403);
      expect((await post(app, { confirmed: true, token }, { "sec-fetch-site": "same-site" })).statusCode).toBe(403);
      const textPlain = await app.inject({ method: "POST", url: "/api/pi-web/restart", headers: { "content-type": "text/plain" }, payload: JSON.stringify({ confirmed: true, token }) });
      expect(textPlain.statusCode).toBe(415);
      expect(restart.schedule).not.toHaveBeenCalled();
    });
  });

  it("schedules only once for concurrent confirmed requests", async () => {
    let finish = (): void => undefined;
    const restart = fakeRestart({ available: true }, vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })));
    await withApp(restart, async (app) => {
      const token = await restartToken(app);
      const first = post(app, { confirmed: true, token });
      await vi.waitFor(() => { expect(restart.schedule).toHaveBeenCalledOnce(); });
      expect((await post(app, { confirmed: true, token })).statusCode).toBe(409);
      finish();
      expect((await first).statusCode).toBe(202);
      expect((await post(app, { confirmed: true, token })).statusCode).toBe(409);
      expect(restart.schedule).toHaveBeenCalledOnce();
    });
  });

  it("reports scheduler failure instead of a receipt and allows a retry", async () => {
    const restart = fakeRestart({ available: true }, vi.fn(() => Promise.reject(new Error("sudo: a password is required"))));
    await withApp(restart, async (app) => {
      const response = await post(app, { confirmed: true, token: await restartToken(app) });
      expect(response.statusCode).toBe(500);
      expect(response.json<{ error: string }>().error).toContain("sudo: a password is required");
      expect((await post(app, { confirmed: true, token: await restartToken(app) })).statusCode).toBe(500);
      expect(restart.schedule).toHaveBeenCalledTimes(2);
    });
  });
});

describe("systemd PI WEB restart backend", () => {
  function recordingRunner(mainPid: string) {
    const calls: string[][] = [];
    const run = (command: string, args: readonly string[]) => {
      calls.push([command, ...args]);
      if (args.includes("--property=MainPID")) return Promise.resolve(`${mainPid}\n`);
      if (args.includes("--property=LoadState")) return Promise.resolve("loaded\n");
      return Promise.resolve("");
    };
    return { calls, run };
  }

  it("is unavailable off Linux without running commands", async () => {
    const { calls, run } = recordingRunner("42");
    const backend = createSystemdPiWebRestartBackend({ platform: "darwin", pid: 42, uid: 1000, run });
    expect(await backend.availability()).toMatchObject({ available: false });
    expect(calls).toEqual([]);
  });

  it("is unavailable when this process is not the web unit's main process", async () => {
    const { run } = recordingRunner("2133");
    const backend = createSystemdPiWebRestartBackend({ platform: "linux", pid: 9999, uid: 1000, run });
    expect(await backend.availability()).toEqual({ available: false, reason: "This process is not the pi-web.service main process." });
  });

  it("checks non-interactive sudo and schedules a delayed web-before-sessiond restart", async () => {
    const { calls, run } = recordingRunner("2133");
    const backend = createSystemdPiWebRestartBackend({ platform: "linux", pid: 2133, uid: 1000, run, unitSuffix: () => "test" });
    expect(await backend.availability()).toEqual({ available: true });
    expect(calls).toContainEqual(["sudo", "-n", "-l", "systemd-run"]);
    calls.length = 0;
    await backend.schedule();
    expect(calls).toEqual([[
      "sudo", "-n", "systemd-run", "--on-active=3s", "--collect", "--unit=pi-web-restart-test", "--",
      "/bin/sh", "-c", "systemctl restart pi-web.service && systemctl restart pi-web-sessiond.service",
    ]]);
  });

  it("runs systemd-run directly as root", async () => {
    const { calls, run } = recordingRunner("1");
    const backend = createSystemdPiWebRestartBackend({ platform: "linux", pid: 1, uid: 0, run, unitSuffix: () => "root" });
    await backend.schedule();
    expect(calls[0]?.[0]).toBe("systemd-run");
  });
});
