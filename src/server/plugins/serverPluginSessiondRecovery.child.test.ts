import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { buildTerminalPackage } from "../../../scripts/build-plugins.mjs";

type FixtureChild = ChildProcessByStdio<null, Readable, Readable>;

const tempRoots: string[] = [];
const children = new Set<FixtureChild>();

afterEach(async () => {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("sessiond persisted server plugin recovery", () => {
  it.each([
    {
      name: "starts from real config and catalog with no server module imports in emergency safe start",
      safeStart: "none",
      expectedDiagnostic: undefined,
    },
    {
      name: "fails closed and starts without server module imports when safe start is malformed",
      safeStart: "future-level",
      expectedDiagnostic: "No server plugins will be loaded until safe start is repaired",
    },
  ])("$name", async ({ safeStart, expectedDiagnostic }) => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-sessiond-plugin-recovery-"));
    tempRoots.push(root);
    const configPath = join(root, "config.json");
    const dataDir = join(root, "data");
    const pluginRoot = join(dataDir, "plugins", "poison");
    const markerPath = join(root, "poison-imported");
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(configPath, `${JSON.stringify({ serverPlugins: { safeStart } })}\n`, "utf8");
    await writeFile(join(pluginRoot, "package.json"), `${JSON.stringify({
      piWeb: { plugins: [{ id: "poison", serverModule: "server.mjs" }] },
    })}\n`, "utf8");
    await writeFile(join(pluginRoot, "server.mjs"), `
      import { writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(markerPath)}, "imported");
      process.exit(97);
    `, "utf8");

    const child = spawn(process.execPath, ["--import", "tsx", "src/server/sessiond.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: join(root, "home"),
        PI_WEB_CONFIG: configPath,
        PI_WEB_DATA_DIR: dataDir,
        PI_WEB_AGENT_DIR: join(root, "agent"),
        PI_WEB_OFFLINE: "1",
        PI_WEB_SESSIOND_PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);

    const startupOutput = await waitForOutput(child, "Server listening at", 15_000);
    expect(startupOutput).toContain("Server listening at");
    if (expectedDiagnostic !== undefined) expect(startupOutput).toContain(expectedDiagnostic);
    expect(existsSync(markerPath)).toBe(false);

    child.kill("SIGTERM");
    const exit = await waitForExit(child, 10_000);
    children.delete(child);

    // Windows has no POSIX signal delivery: SIGTERM force-terminates the
    // child, so the graceful-shutdown exit code only holds on POSIX hosts.
    expect(exit).toEqual(
      process.platform === "win32" ? { code: null, signal: "SIGTERM" } : { code: 0, signal: null },
    );
    expect(existsSync(markerPath)).toBe(false);
    expect(existsSync(join(dataDir, "plugin-state"))).toBe(false);
  }, 30_000);

  it.skipIf(process.platform === "win32")("starts a state-only plugin in the early sessiond plugin phase and revokes state before disposal", async () => {
    const terminalPackageRoot = resolve("dist/pi-web-plugins/terminal");
    tempRoots.push(terminalPackageRoot);
    await buildTerminalPackage(resolve("pi-web-plugins/terminal"), terminalPackageRoot);

    const root = await mkdtemp(join(tmpdir(), "pi-web-sessiond-plugin-state-"));
    tempRoots.push(root);
    const configPath = join(root, "config.json");
    const dataDir = join(root, "data");
    const pluginRoot = join(dataDir, "plugins", "state-only");
    const startedMarker = join(root, "state-plugin-started.json");
    const disposedMarker = join(root, "state-plugin-disposed.txt");
    const serverApiUrl = pathToFileURL(resolve("src/server-plugin-api.ts")).href;
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(configPath, "{}\n", "utf8");
    await writeFile(join(pluginRoot, "package.json"), `${JSON.stringify({
      piWeb: { plugins: [{ id: "state-only", serverModule: "server.mjs" }] },
    })}\n`, "utf8");
    await writeFile(join(pluginRoot, "server.mjs"), `
      import { writeFile } from "node:fs/promises";
      import { PI_WEB_HOST_STATE_CAPABILITY } from ${JSON.stringify(serverApiUrl)};
      let state;
      export default {
        apiVersion: 3,
        name: "State-only fixture",
        requires: [PI_WEB_HOST_STATE_CAPABILITY],
        activate(context) {
          return {
            async start({ capabilities }) {
              state = capabilities.resolve(PI_WEB_HOST_STATE_CAPABILITY);
              const previous = await state.read();
              await state.write({ starts: (previous?.starts ?? 0) + 1 });
              await writeFile(${JSON.stringify(startedMarker)}, JSON.stringify({ packageRoot: context.packageRoot }));
              console.error("STATE_PLUGIN_STARTED");
            },
            async dispose() {
              try {
                await state.read();
                await writeFile(${JSON.stringify(disposedMarker)}, "state remained active");
              } catch (error) {
                await writeFile(${JSON.stringify(disposedMarker)}, error instanceof Error ? error.message : String(error));
              }
            }
          };
        }
      };
    `, "utf8");

    const child = spawn(process.execPath, ["--import", "tsx", "src/server/sessiond.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: join(root, "home"),
        PI_WEB_CONFIG: configPath,
        PI_WEB_DATA_DIR: dataDir,
        PI_WEB_AGENT_DIR: join(root, "agent"),
        PI_WEB_OFFLINE: "1",
        PI_WEB_SESSIOND_PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);

    const startupOutput = await waitForOutput(child, "Server listening at", 15_000);
    expect(startupOutput).toContain("STATE_PLUGIN_STARTED");
    expect(JSON.parse(await readFile(startedMarker, "utf8"))).toEqual({ packageRoot: pluginRoot });
    expect(JSON.parse(await readFile(join(dataDir, "plugin-state", "state-only", "state.json"), "utf8")))
      .toEqual({ starts: 1 });
    expect((await readdir(pluginRoot)).sort()).toEqual(["package.json", "server.mjs"]);

    child.kill("SIGTERM");
    const exit = await waitForExit(child, 10_000);
    children.delete(child);

    expect(exit).toEqual({ code: 0, signal: null });
    expect(await readFile(disposedMarker, "utf8")).toContain("state for state-only is no longer active");
  }, 35_000);

  it.skipIf(process.platform === "win32")("assembles early workspace providers before resuming late workspace consumers", async () => {
    const terminalPackageRoot = resolve("dist/pi-web-plugins/terminal");
    tempRoots.push(terminalPackageRoot);
    await buildTerminalPackage(resolve("pi-web-plugins/terminal"), terminalPackageRoot);

    const root = await mkdtemp(join(tmpdir(), "pi-web-sessiond-plugin-workspaces-"));
    tempRoots.push(root);
    const configPath = join(root, "config.json");
    const dataDir = join(root, "data");
    const projectPath = join(root, "project");
    const projectId = "project-live-authority";
    const workspaceId = createHash("sha1").update(`${projectId}:main`).digest("hex").slice(0, 12);
    const eventsPath = join(root, "events.log");
    const authorityMarker = join(root, "workspace-authority.json");
    const disposedMarker = join(root, "workspace-consumer-disposed.txt");
    const serverApiUrl = pathToFileURL(resolve("src/server-plugin-api.ts")).href;
    await Promise.all([
      mkdir(projectPath, { recursive: true }),
      mkdir(join(dataDir, "plugins"), { recursive: true }),
    ]);
    await writeFile(configPath, "{}\n", "utf8");
    await writeFile(join(dataDir, "projects.json"), `${JSON.stringify({
      projects: [{
        id: projectId,
        name: "Live project",
        path: projectPath,
        createdAt: "2026-09-10T00:00:00.000Z",
      }],
    })}\n`, "utf8");

    const providerRoot = join(dataDir, "plugins", "provider");
    await mkdir(providerRoot, { recursive: true });
    await writeFile(join(providerRoot, "package.json"), `${JSON.stringify({
      piWeb: { plugins: [{ id: "a-workspace-provider", serverModule: "server.mjs" }] },
    })}\n`, "utf8");
    await writeFile(join(providerRoot, "server.mjs"), `
      import { appendFile } from "node:fs/promises";
      export default {
        apiVersion: 3,
        name: "Workspace provider fixture",
        activate() {
          return {
            workspaceProvider: {
              async probe(project) { return project.id === ${JSON.stringify(projectId)} ? "claim" : "pass"; },
              async list(project) {
                return [{
                  key: "main",
                  path: project.path,
                  label: "Provider main",
                  isMain: true,
                  data: { privateToken: "not-public" },
                  publicMetadata: { topology: "live" }
                }];
              }
            },
            async start() { await appendFile(${JSON.stringify(eventsPath)}, "provider:start\\n"); },
            async dispose() { await appendFile(${JSON.stringify(eventsPath)}, "provider:dispose\\n"); }
          };
        }
      };
    `, "utf8");

    const stateRoot = join(dataDir, "plugins", "state-early");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(join(stateRoot, "package.json"), `${JSON.stringify({
      piWeb: { plugins: [{ id: "b-state-early", serverModule: "server.mjs" }] },
    })}\n`, "utf8");
    await writeFile(join(stateRoot, "server.mjs"), `
      import { appendFile } from "node:fs/promises";
      import { PI_WEB_HOST_STATE_CAPABILITY } from ${JSON.stringify(serverApiUrl)};
      export default {
        apiVersion: 3,
        name: "Early state fixture",
        requires: [PI_WEB_HOST_STATE_CAPABILITY],
        activate() {
          return {
            async start({ capabilities }) {
              const state = capabilities.resolve(PI_WEB_HOST_STATE_CAPABILITY);
              await state.write({ phase: "early" });
              await appendFile(${JSON.stringify(eventsPath)}, "state:start\\n");
            }
          };
        }
      };
    `, "utf8");

    const consumerRoot = join(dataDir, "plugins", "workspace-consumer");
    await mkdir(consumerRoot, { recursive: true });
    await writeFile(join(consumerRoot, "package.json"), `${JSON.stringify({
      piWeb: { plugins: [{ id: "z-workspace-consumer", serverModule: "server.mjs" }] },
    })}\n`, "utf8");
    await writeFile(join(consumerRoot, "server.mjs"), `
      import { appendFile, writeFile } from "node:fs/promises";
      import { PI_WEB_HOST_WORKSPACES_CAPABILITY } from ${JSON.stringify(serverApiUrl)};
      let workspaces;
      const selection = ${JSON.stringify({ projectId, workspaceId })};
      export default {
        apiVersion: 3,
        name: "Workspace consumer fixture",
        requires: [PI_WEB_HOST_WORKSPACES_CAPABILITY],
        activate() {
          return {
            async start({ capabilities }) {
              workspaces = capabilities.resolve(PI_WEB_HOST_WORKSPACES_CAPABILITY);
              const authority = await workspaces.resolve(selection);
              await writeFile(${JSON.stringify(authorityMarker)}, JSON.stringify(authority));
              await appendFile(${JSON.stringify(eventsPath)}, "consumer:start\\n");
              console.error("WORKSPACE_CONSUMER_STARTED");
            },
            async dispose() {
              try {
                await workspaces.resolve(selection);
                await writeFile(${JSON.stringify(disposedMarker)}, "workspace authority remained active");
              } catch (error) {
                await writeFile(${JSON.stringify(disposedMarker)}, error instanceof Error ? error.message : String(error));
              }
            }
          };
        }
      };
    `, "utf8");

    const child = spawn(process.execPath, ["--import", "tsx", "src/server/sessiond.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: join(root, "home"),
        PI_WEB_CONFIG: configPath,
        PI_WEB_DATA_DIR: dataDir,
        PI_WEB_AGENT_DIR: join(root, "agent"),
        PI_WEB_OFFLINE: "1",
        PI_WEB_SESSIOND_PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);

    const startupOutput = await waitForOutput(child, "Server listening at", 20_000);
    expect(startupOutput).toContain("WORKSPACE_CONSUMER_STARTED");
    expect((await readFile(eventsPath, "utf8")).trim().split("\n")).toEqual([
      "provider:start",
      "state:start",
      "consumer:start",
    ]);
    expect(JSON.parse(await readFile(authorityMarker, "utf8"))).toEqual({
      project: { id: projectId, name: "Live project", path: projectPath },
      workspace: {
        id: workspaceId,
        projectId,
        path: projectPath,
        label: "Provider main",
        isMain: true,
        provider: {
          pluginId: "a-workspace-provider",
          capabilities: { remove: false },
          metadata: { topology: "live" },
        },
      },
    });
    expect(JSON.parse(await readFile(join(dataDir, "plugin-state", "b-state-early", "state.json"), "utf8")))
      .toEqual({ phase: "early" });

    child.kill("SIGTERM");
    const exit = await waitForExit(child, 10_000);
    children.delete(child);

    expect(exit).toEqual({ code: 0, signal: null });
    expect(await readFile(disposedMarker, "utf8"))
      .toContain("workspace authority for server plugin z-workspace-consumer is no longer active");
    expect((await readFile(eventsPath, "utf8")).trim().split("\n")).toEqual([
      "provider:start",
      "state:start",
      "consumer:start",
      "provider:dispose",
    ]);
  }, 40_000);

  // Plugin stop on SIGTERM requires POSIX signal delivery; Windows
  // force-terminates the child without running shutdown handlers.
  it.skipIf(process.platform === "win32")("disposes activated plugins when SIGTERM arrives during sessiond startup", async () => {
    // This source-level child bypasses start:sessiond's build:plugins prerequisite.
    const terminalPackageRoot = resolve("dist/pi-web-plugins/terminal");
    tempRoots.push(terminalPackageRoot);
    await buildTerminalPackage(resolve("pi-web-plugins/terminal"), terminalPackageRoot);

    const root = await mkdtemp(join(tmpdir(), "pi-web-sessiond-plugin-startup-signal-"));
    tempRoots.push(root);
    const configPath = join(root, "config.json");
    const dataDir = join(root, "data");
    const pluginRoot = join(dataDir, "plugins", "startup-signal");
    const startedMarker = join(root, "plugin-started");
    const stoppedMarker = join(root, "plugin-stopped");
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(configPath, "{}\n", "utf8");
    await writeFile(join(pluginRoot, "package.json"), `${JSON.stringify({
      piWeb: { plugins: [{ id: "startup-signal", serverModule: "server.mjs" }] },
    })}\n`, "utf8");
    await writeFile(join(pluginRoot, "server.mjs"), `
      import { writeFileSync } from "node:fs";
      export default {
        apiVersion: 3,
        name: "Startup signal fixture",
        activate() {
          return {
            async start() {
              writeFileSync(${JSON.stringify(startedMarker)}, "started");
              console.error("PLUGIN_STARTED");
              await new Promise((resolve) => setTimeout(resolve, 250));
            },
            dispose() {
              writeFileSync(${JSON.stringify(stoppedMarker)}, "stopped");
            }
          };
        }
      };
    `, "utf8");

    const child = spawn(process.execPath, ["--import", "tsx", "src/server/sessiond.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: join(root, "home"),
        PI_WEB_CONFIG: configPath,
        PI_WEB_DATA_DIR: dataDir,
        PI_WEB_AGENT_DIR: join(root, "agent"),
        PI_WEB_OFFLINE: "1",
        PI_WEB_SESSIOND_PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);

    await waitForOutput(child, "PLUGIN_STARTED", 15_000);
    expect(existsSync(startedMarker)).toBe(true);
    child.kill("SIGTERM");
    const exit = await waitForExit(child, 15_000);
    children.delete(child);

    expect(exit).toEqual({ code: 0, signal: null });
    expect(existsSync(stoppedMarker)).toBe(true);
  }, 35_000);
});

function waitForOutput(child: FixtureChild, expected: string, timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      rejectPromise(new Error(`Timed out waiting for child output ${JSON.stringify(expected)}:\n${output}`));
    }, timeoutMs);
    const onData = (chunk: unknown): void => {
      output += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      if (!output.includes(expected)) return;
      cleanup();
      resolvePromise(output);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      rejectPromise(new Error(`Child exited before readiness (${String(code)}, ${String(signal)}):\n${output}`));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", onExit);
  });
}

function waitForExit(
  child: FixtureChild,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectPromise(new Error("Timed out waiting for sessiond shutdown"));
    }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      resolvePromise({ code, signal });
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.off("exit", onExit);
    };
    child.once("exit", onExit);
  });
}
