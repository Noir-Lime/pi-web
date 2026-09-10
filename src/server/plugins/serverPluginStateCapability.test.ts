import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PI_WEB_HOST_STATE_CAPABILITY } from "../../server-plugin-api.js";
import { serverPluginStateFilePath } from "../storage/serverPluginStateStore.js";
import { createServerPluginStateCapabilityFactory } from "./serverPluginStateCapability.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("server plugin state host capability", () => {
  it("isolates exact declaring packages under the data directory and never writes package roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-state-capability-test-"));
    tempRoots.push(root);
    const dataDir = join(root, "data");
    const alphaPackage = join(root, "packages", "alpha");
    const betaPackage = join(root, "packages", "beta");
    await Promise.all([
      mkdir(alphaPackage, { recursive: true }),
      mkdir(betaPackage, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(alphaPackage, "package.json"), "{}\n", "utf8"),
      writeFile(join(betaPackage, "package.json"), "{}\n", "utf8"),
    ]);
    const alphaLifetime = new AbortController();
    const betaLifetime = new AbortController();
    const factory = createServerPluginStateCapabilityFactory({ dataDir });

    const alphaInstance = factory.create(Object.freeze({
      pluginId: "alpha",
      packageRoot: alphaPackage,
      lifetimeSignal: alphaLifetime.signal,
    }));
    const betaInstance = factory.create(Object.freeze({
      pluginId: "beta",
      packageRoot: betaPackage,
      lifetimeSignal: betaLifetime.signal,
    }));
    const alpha = PI_WEB_HOST_STATE_CAPABILITY.parse(alphaInstance.value);
    const beta = PI_WEB_HOST_STATE_CAPABILITY.parse(betaInstance.value);
    await Promise.all([
      alpha.write({ owner: "alpha" }),
      beta.write({ owner: "beta" }),
    ]);

    await expect(alpha.read()).resolves.toEqual({ owner: "alpha" });
    await expect(beta.read()).resolves.toEqual({ owner: "beta" });
    expect(JSON.parse(await readFile(serverPluginStateFilePath(dataDir, "alpha"), "utf8")))
      .toEqual({ owner: "alpha" });
    expect(JSON.parse(await readFile(serverPluginStateFilePath(dataDir, "beta"), "utf8")))
      .toEqual({ owner: "beta" });
    expect(await readdir(alphaPackage)).toEqual(["package.json"]);
    expect(await readdir(betaPackage)).toEqual(["package.json"]);

    alphaLifetime.abort(new DOMException("revoked", "AbortError"));
    await expect(alpha.read()).rejects.toThrow("state for alpha is no longer active");
    await expect(beta.read()).resolves.toEqual({ owner: "beta" });
    await alphaInstance.dispose?.(new AbortController().signal);
    await betaInstance.dispose?.(new AbortController().signal);
  });
});
