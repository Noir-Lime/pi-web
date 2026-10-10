import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectInput,
  ServerPluginActivationContext,
  ServerPluginExecFileResult,
  WorkspaceProvider,
  WorkspaceProviderIntegration,
} from "@jmfederico/pi-web/server-plugin-api";
import { createServerPluginExecFile } from "../../src/server/plugins/serverPluginExec.js";
import plugin from "./server-plugin.js";
import { createWorkspaceDiscoveryHooks } from "./workspaceDiscoveryHooks.js";

const temporaryRoots: string[] = [];
const gitLocalEnvironmentKeys = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_CONFIG", "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS", "GIT_DIR", "GIT_GRAFT_FILE", "GIT_IMPLICIT_WORK_TREE", "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS", "GIT_OBJECT_DIRECTORY", "GIT_PREFIX", "GIT_QUARANTINE_PATH",
  "GIT_REPLACE_REF_BASE", "GIT_SHALLOW_FILE", "GIT_WORK_TREE",
];
const signal = () => new AbortController().signal;
const gitEnvironment = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
for (const key of gitLocalEnvironmentKeys) Reflect.deleteProperty(gitEnvironment, key);
const configHelp = spawnSync("git", ["help", "--config"], { encoding: "utf8", env: gitEnvironment, timeout: 10_000 });
const advertisedConfig = configHelp.status === 0 ? configHelp.stdout.split(/\r?\n/u) : [];
const gitAvailable = configHelp.error === undefined && configHelp.status !== null;
const namedHooksSupported = configHelp.status === 0
  && advertisedConfig.includes("hook.<friendly-name>.command") && advertisedConfig.includes("hook.<friendly-name>.event");

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

// These fixtures use POSIX executable scripts and shell quoting. Keep the
// platform-independent settings/unsupported-Git contracts below active in CI.
describe.skipIf(process.platform === "win32" || !namedHooksSupported)("Git-owned workspace discovery hooks (real Git)", () => {
  it("lazily installs coexistable per-project named hooks without touching hooksPath or scripts", async () => {
    const fixture = await repositoryFixture();
    const hooks = join(fixture.root, "existing hooks ' directory");
    const traditionalMarker = join(fixture.root, "traditional marker");
    const otherMarker = join(fixture.root, "other named marker");
    await mkdir(hooks);
    const script = `#!/bin/sh\nprintf traditional >> ${quote(traditionalMarker)}\n`;
    await writeFile(join(hooks, "post-checkout"), script, { mode: 0o755 });
    fixture.git(["config", "core.hooksPath", hooks]);
    fixture.git(["config", "hook.other.command", `printf other >> ${quote(otherMarker)}`]);
    fixture.git(["config", "hook.other.event", "post-checkout"]);
    const first = fixture.project;
    const second = { ...first, id: "second ' registration", path: join(first.path, "sub folder") };
    await mkdir(second.path);
    const { provider, integration, context } = await fixture.activate();

    // Probe/list remain read-only; only the host's explicit integration seam installs.
    await provider.probe(first, signal());
    await provider.list(first, signal());
    await expect(readdir(context.dataDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await Promise.all([integration.reconcile(first, signal()), integration.reconcile(second, signal())]);
    const keys = fixture.ownedKeys();
    expect(keys.filter((key) => key.endsWith(".command"))).toHaveLength(2);
    const helpers = await fixture.helpers(context.dataDirectory);
    expect(helpers).toHaveLength(2);
    expect((await readdir(join(context.dataDirectory, "workspace-discovery"))).sort()).toEqual(registrationFiles(helpers));
    expect(fixture.git(["config", "core.hooksPath"]).trim()).toBe(hooks);
    expect(await readFile(join(hooks, "post-checkout"), "utf8")).toBe(script);

    const linked = join(fixture.root, "new ' worktree with spaces");
    fixture.git(["worktree", "add", "-b", "feature", linked]);
    expect(await fixture.notifications()).toEqual([
      fixture.expectedNotification(first.id), fixture.expectedNotification(second.id),
    ]);
    expect(await readFile(traditionalMarker, "utf8")).toBe("traditional");
    expect(await readFile(otherMarker, "utf8")).toBe("other");
    expect(fixture.git(["hook", "list", "post-checkout"])).toContain("other");
  });

  it("is idempotent and repairs only missing/changed helpers and owned config", async () => {
    const fixture = await repositoryFixture();
    const { integration, context } = await fixture.activate();
    await integration.reconcile(fixture.project, signal());
    const helper = await fixture.helper(context.dataDirectory);
    const original = await readFile(helper, "utf8");
    const config = join(fixture.project.path, ".git", "config");
    const metadata = registrationMetadataPath(helper);
    const originalMetadata = await readFile(metadata, "utf8");
    const unchangedState = async () => Promise.all([helper, metadata, config].map(async (path) => {
      const { ino, mtimeNs, ctimeNs } = await stat(path, { bigint: true });
      return { ino, mtimeNs, ctimeNs };
    }));
    const before = await unchangedState();
    fixture.execFile.mockClear();

    await integration.reconcile(fixture.project, signal());

    expect(await unchangedState()).toEqual(before);
    expect(fixture.execFile.mock.calls.filter(([request]) => request.args?.includes("--replace-all") === true)).toHaveLength(0);
    const commandKey = fixture.ownedKeys().find((key) => key.endsWith(".command"));
    if (commandKey === undefined) throw new Error("Expected installed hook");
    const eventKey = commandKey.replace(/\.command$/u, ".event");
    await writeFile(helper, "damaged helper\n");
    fixture.git(["config", "--local", eventKey, "post-merge"]);
    await integration.reconcile(fixture.project, signal());
    expect(await readFile(helper, "utf8")).toBe(original);
    expect(fixture.git(["config", "--get-all", eventKey])).toBe("post-checkout\n");
    await rm(helper);
    fixture.git(["config", "--local", "--unset-all", commandKey]);
    await integration.reconcile(fixture.project, signal());
    expect(await readFile(helper, "utf8")).toBe(original);
    const command = fixture.git(["config", "--get-all", commandKey]);
    expect(command).toContain(quote(process.execPath));
    expect(command).not.toContain("sh -c ");
    expect(await readFile(metadata, "utf8")).toBe(originalMetadata);
    expect((await readdir(join(context.dataDirectory, "workspace-discovery"))).sort()).toEqual(registrationFiles([helper]));
  });

  it("repairs a known prior absolute Node executable across integration instances", async () => {
    const fixture = await repositoryFixture();
    const { context } = await fixture.activate();
    const oldNode = join(fixture.root, "removed ' Node installation", "node");
    const prior = createWorkspaceDiscoveryHooks(context, fixture.runGit, oldNode);
    await prior.reconcile(fixture.project, signal());
    const helper = await fixture.helper(context.dataDirectory);
    const originalHelper = await readFile(helper, "utf8");
    const originalMetadata = await readFile(registrationMetadataPath(helper), "utf8");
    const commandKey = fixture.ownedKeys().find((key) => key.endsWith(".command"));
    if (commandKey === undefined) throw new Error("Expected installed hook");
    expect(fixture.git(["config", "--local", commandKey])).toContain(quote(oldNode));

    const current = createWorkspaceDiscoveryHooks(context, fixture.runGit, process.execPath);
    await current.reconcile(fixture.project, signal());

    const repairedCommand = fixture.git(["config", "--local", commandKey]);
    expect(repairedCommand).toContain(quote(process.execPath));
    expect(repairedCommand).not.toContain(quote(oldNode));
    expect(await fixture.helper(context.dataDirectory)).toBe(helper);
    expect(await readFile(helper, "utf8")).toBe(originalHelper);
    expect(await readFile(registrationMetadataPath(helper), "utf8")).not.toBe(originalMetadata);
    expect((await readdir(join(context.dataDirectory, "workspace-discovery"))).sort()).toEqual(registrationFiles([helper]));
    fixture.git(["worktree", "add", "-b", "new-node", join(fixture.root, "new Node checkout")]);
    expect(await fixture.notifications()).toEqual([fixture.expectedNotification(fixture.project.id)]);
  });

  it("opts out of a known prior Node registration without first repairing it", async () => {
    const fixture = await repositoryFixture();
    const settings = vi.fn<NonNullable<ServerPluginActivationContext["resolveProjectSettings"]>>(() => Promise.resolve({ workspaceDiscoveryHooks: true }));
    const { context } = await fixture.activate({ resolveProjectSettings: settings });
    const prior = createWorkspaceDiscoveryHooks(context, fixture.runGit, join(fixture.root, "old ' Node installation", "node"));
    await prior.reconcile(fixture.project, signal());
    const helper = await fixture.helper(context.dataDirectory);
    await expect(readFile(registrationMetadataPath(helper))).resolves.toBeInstanceOf(Buffer);
    settings.mockResolvedValue({ workspaceDiscoveryHooks: false });
    const current = createWorkspaceDiscoveryHooks(context, fixture.runGit, process.execPath);

    await current.reconcile(fixture.project, signal());

    expect(fixture.ownedKeys()).toEqual([]);
    await expect(readFile(helper)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(registrationMetadataPath(helper))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(join(context.dataDirectory, "workspace-discovery"))).toEqual([]);
    await expect(current.acceptNotification(fixture.project, signal())).resolves.toBe(false);
  });

  it("does not claim the same wrapper with an unrecorded Node executable", async () => {
    const fixture = await repositoryFixture();
    const { integration, context } = await fixture.activate();
    await integration.reconcile(fixture.project, signal());
    const helper = await fixture.helper(context.dataDirectory);
    const metadata = await readFile(registrationMetadataPath(helper), "utf8");
    const commandKey = fixture.ownedKeys().find((key) => key.endsWith(".command"));
    if (commandKey === undefined) throw new Error("Expected installed hook");
    const command = fixture.git(["config", "--local", commandKey]).trim();
    const foreignCommand = command.replace(quote(process.execPath), quote(join(fixture.root, "unrecorded Node", "node")));
    expect(foreignCommand).not.toBe(command);
    fixture.git(["config", "--local", commandKey, foreignCommand]);
    const current = createWorkspaceDiscoveryHooks(context, fixture.runGit, process.execPath);

    await expect(current.reconcile(fixture.project, signal())).rejects.toThrow("hook conflict");
    const disabled = await fixture.activate({ settings: { workspaceDiscoveryHooks: false } });
    await expect(disabled.integration.reconcile(fixture.project, signal())).rejects.toThrow("hook conflict");

    expect(fixture.git(["config", "--local", commandKey]).trim()).toBe(foreignCommand);
    await expect(readFile(helper)).resolves.toBeInstanceOf(Buffer);
    expect(await readFile(registrationMetadataPath(helper), "utf8")).toBe(metadata);
  });

  it("refreshes daemon-targeted argv in the stable helper without rewriting registration config", async () => {
    const fixture = await repositoryFixture();
    const { integration, context } = await fixture.activate();
    await integration.reconcile(fixture.project, signal());
    const helper = await fixture.helper(context.dataDirectory);
    const originalCommand = context.workspaceNotifications?.command(fixture.project.id);
    if (originalCommand === undefined) throw new Error("Expected host notification command");
    const nextArguments = ["--daemon-target", "replacement daemon ' target", "--project", fixture.project.id, ""];
    const refreshed = await fixture.activate({ workspaceNotifications: {
      command: () => [...originalCommand.slice(0, 3), ...nextArguments],
    } });
    fixture.execFile.mockClear();

    await refreshed.integration.reconcile(fixture.project, signal());

    expect(await fixture.helper(context.dataDirectory)).toBe(helper);
    expect(fixture.execFile.mock.calls.filter(([request]) => request.args?.includes("--replace-all") === true)).toHaveLength(0);
    fixture.git(["worktree", "add", "-b", "new-daemon", join(fixture.root, "new daemon checkout")]);
    expect(await fixture.notifications()).toEqual([nextArguments]);
  });

  it("opts out using resolved project snapshots, removing only its exact keys and leaving listing unchanged", async () => {
    const fixture = await repositoryFixture();
    const { integration, context } = await fixture.activate();
    const second = { ...fixture.project, id: "another project" };
    await integration.reconcile(fixture.project, signal());
    await integration.reconcile(second, signal());
    const ownKeys = fixture.ownedKeys();
    fixture.git(["config", "hook.other.command", "sh -c ':'"]);
    fixture.git(["config", "hook.other.event", "post-checkout"]);
    const helper = await fixture.helperForProject(context.dataDirectory, fixture.project.id);
    const settings = vi.fn<NonNullable<ServerPluginActivationContext["resolveProjectSettings"]>>(() => Promise.resolve({ workspaceDiscoveryHooks: false }));
    const disabled = await fixture.activate({ resolveProjectSettings: settings });
    const invocationSignal = signal();
    const before = await disabled.provider.list(fixture.project, invocationSignal);
    const execute = fixture.execFile.getMockImplementation();
    if (execute === undefined) throw new Error("Expected Git execution fixture");
    fixture.execFile.mockImplementation(async (request) => {
      const result = await execute(request);
      // Every intermediate removal state must remain runnable. Disconnecting
      // the command before its event would make Git reject the hook catalog.
      if (request.args?.includes("--unset-all") === true) fixture.git(["hook", "list", "post-checkout"]);
      return result;
    });

    await disabled.integration.reconcile(fixture.project, invocationSignal);

    expect(settings).toHaveBeenCalledWith(fixture.project, invocationSignal);
    expect(fixture.ownedKeys()).toHaveLength(2);
    expect(fixture.ownedKeys().every((key) => ownKeys.includes(key))).toBe(true);
    await expect(readFile(helper)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(registrationMetadataPath(helper))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(join(context.dataDirectory, "workspace-discovery"))).sort()).toEqual(registrationFiles(await fixture.helpers(context.dataDirectory)));
    expect(fixture.git(["config", "hook.other.command"])).toBe("sh -c ':'\n");
    await expect(disabled.integration.acceptNotification(fixture.project, signal())).resolves.toBe(false);
    await expect(disabled.provider.list(fixture.project, signal())).resolves.toEqual(before);
    fixture.git(["worktree", "add", "-b", "still-discovered", join(fixture.root, "after opt-out")]);
    expect(await fixture.notifications()).toEqual([fixture.expectedNotification(second.id)]);
    await expect(disabled.provider.list(fixture.project, signal())).resolves.toHaveLength(2);
  });

  it.each(["local", "global", "worktree"] as const)("rejects %s same-name command conflicts instead of invisibly overriding them", async (scope) => {
    const fixture = await repositoryFixture();
    const { integration, context } = await fixture.activate();
    await integration.reconcile(fixture.project, signal());
    const helper = await fixture.helper(context.dataDirectory);
    const original = await readFile(helper, "utf8");
    const metadata = await readFile(registrationMetadataPath(helper), "utf8");
    const commandKey = fixture.ownedKeys().find((key) => key.endsWith(".command"));
    if (commandKey === undefined) throw new Error("Expected installed hook");
    const ownedCommand = fixture.git(["config", "--local", commandKey]).trim();
    if (scope === "worktree") fixture.git(["config", "extensions.worktreeConfig", "true"]);
    const foreignCommand = `${scope}-external-command`;
    fixture.git(["config", `--${scope}`, commandKey, foreignCommand]);

    await expect(integration.reconcile(fixture.project, signal())).rejects.toThrow("hook conflict");
    const disabled = await fixture.activate({ settings: { workspaceDiscoveryHooks: false } });
    await expect(disabled.integration.reconcile(fixture.project, signal())).rejects.toThrow("hook conflict");

    expect(fixture.git(["config", `--${scope}`, commandKey])).toBe(`${foreignCommand}\n`);
    if (scope !== "local") expect(fixture.git(["config", "--local", commandKey]).trim()).toBe(ownedCommand);
    expect(await readFile(helper, "utf8")).toBe(original);
    expect(await readFile(registrationMetadataPath(helper), "utf8")).toBe(metadata);
  });

  it("notifies for initial checkout only, not ordinary switches/file checkouts or the --no-checkout gap", async () => {
    const fixture = await repositoryFixture();
    const { integration, provider } = await fixture.activate();
    await integration.reconcile(fixture.project, signal());
    fixture.git(["switch", "-c", "ordinary-switch"]);
    fixture.git(["checkout", "--", "tracked.txt"]);
    fixture.git(["hook", "run", "post-checkout", "--", "0".repeat(40), "new oid", "0"]);
    fixture.git(["hook", "run", "post-checkout", "--", "not-a-null-oid", "new oid", "1"]);
    const gap = join(fixture.root, "no checkout");
    fixture.git(["worktree", "add", "--no-checkout", "-b", "gap", gap]);
    expect(await fixture.notifications()).toEqual([]);
    expect((await provider.list(fixture.project, signal())).map((workspace) => workspace.path)).toContain(gap);
    fixture.git(["worktree", "add", "-b", "initial-checkout", join(fixture.root, "checked out")]);
    expect(await fixture.notifications()).toEqual([fixture.expectedNotification(fixture.project.id)]);
    fixture.git(["hook", "run", "post-checkout", "--", "0".repeat(64), "new oid", "1"]);
    expect(await fixture.notifications()).toHaveLength(2);
  });

  it("preserves Git's hook argv exactly and guards a missing or failing helper", async () => {
    const fixture = await repositoryFixture();
    const { integration, context } = await fixture.activate();
    await integration.reconcile(fixture.project, signal());
    const helper = await fixture.helper(context.dataDirectory);
    const captured = join(fixture.root, "captured hook args");
    await writeFile(helper, `require("node:fs").writeFileSync(${JSON.stringify(captured)}, JSON.stringify(process.argv.slice(2))); process.exit(37);\n`);
    const args = ["previous ' with spaces", 'next " $`\\ value', ""];
    fixture.git(["hook", "run", "post-checkout", "--", ...args]);
    expect(JSON.parse(await readFile(captured, "utf8"))).toEqual(args);
    const commandKey = fixture.ownedKeys().find((key) => key.endsWith(".command"));
    if (commandKey === undefined) throw new Error("Expected installed hook");
    const command = fixture.git(["config", "--local", commandKey]).trim();
    await rm(captured);
    // Git supplies its own shell; the wrapper must not look up another sh on PATH.
    fixture.git(["-c", `${commandKey}=PATH=; ${command}`, "hook", "run", "post-checkout", "--", ...args]);
    expect(JSON.parse(await readFile(captured, "utf8"))).toEqual(args);
    await rm(helper);
    fixture.git(["worktree", "add", "-b", "missing-helper", join(fixture.root, "missing helper checkout")]);
    expect(await fixture.notifications()).toEqual([]);
  });

  it("keeps daemon-unavailable/missing-notifier failures harmless and preserves existing Git hook failures", async () => {
    const fixture = await repositoryFixture();
    const { integration } = await fixture.activate({ workspaceNotifications: { command: () => [process.execPath, "-e", "process.exit(19)"] } });
    await integration.reconcile(fixture.project, signal());
    fixture.git(["worktree", "add", "-b", "offline-daemon", join(fixture.root, "offline daemon")]);
    const missing = await fixture.activate({ workspaceNotifications: { command: () => [join(fixture.root, "absent notifier")] } });
    await missing.integration.reconcile(fixture.project, signal());
    fixture.git(["worktree", "add", "-b", "absent-notifier", join(fixture.root, "absent notifier checkout")]);
    const withoutNotifier = { ...missing.context };
    delete withoutNotifier.workspaceNotifications;
    const disabled = await activate(withoutNotifier);
    await disabled.integration.reconcile(fixture.project, signal());
    expect(fixture.ownedKeys()).toEqual([]);
    await expect(disabled.integration.acceptNotification(fixture.project, signal())).resolves.toBe(false);
    fixture.git(["config", "hook.fail.command", "sh -c 'exit 23'"]);
    fixture.git(["config", "hook.fail.event", "post-checkout"]);
    const args = ["hook", "run", "post-checkout", "--", "0".repeat(40), "new", "1"];
    const before = fixture.gitOutcome(args);
    expect(before.status).not.toBe(0);
    await missing.integration.reconcile(fixture.project, signal());
    expect(fixture.gitOutcome(args).status).toBe(before.status);
    expect(fixture.gitOutcome(["worktree", "add", "-b", "failure", fixture.project.path]).status).not.toBe(0);
  });

  it("bounds even a hung notification command and kills it without failing checkout", async () => {
    const fixture = await repositoryFixture();
    const pidFile = join(fixture.root, "hung notifier pid");
    const hung = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const { integration } = await fixture.activate({ workspaceNotifications: { command: () => [process.execPath, "-e", hung] } });
    await integration.reconcile(fixture.project, signal());

    fixture.git(["worktree", "add", "-b", "bounded", join(fixture.root, "bounded checkout")]);

    const pid = Number(await readFile(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 10_000);

  it("uses project-specific atomic helper writes across activations sharing a data directory", async () => {
    const fixture = await repositoryFixture();
    const secondPath = join(fixture.root, "second repo");
    await mkdir(secondPath);
    fixture.git(["init", "-b", "main", secondPath]);
    const second = { id: "second repo", name: "Second", path: secondPath };
    const firstActivation = await fixture.activate();
    const secondActivation = await fixture.activate();
    await Promise.all([
      firstActivation.integration.reconcile(fixture.project, signal()),
      secondActivation.integration.reconcile(second, signal()),
    ]);
    const helpers = await fixture.helpers(firstActivation.context.dataDirectory);
    expect(helpers).toHaveLength(2);
    expect((await readdir(join(firstActivation.context.dataDirectory, "workspace-discovery"))).sort()).toEqual(registrationFiles(helpers));
    expect(fixture.git(["-C", secondPath, "hook", "list", "post-checkout"])).toContain("pi-web-workspace-discovery-");
    // All plugin Git operations, including feature detection/config, are bounded
    // and strip poisoned repository-local environment variables.
    for (const [request] of fixture.execFile.mock.calls) {
      expect(request.file).toBe("git");
      expect(request.unsetEnv).toEqual(expect.arrayContaining(gitLocalEnvironmentKeys));
      expect(request.timeoutMs).toBe(10_000);
      expect(request.signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe("workspace discovery settings and unsupported Git boundary", () => {
  it.skipIf(process.platform === "win32" || !gitAvailable || namedHooksSupported)("leaves real old-Git config and scripts untouched when named hooks are unavailable", async () => {
    const fixture = await repositoryFixture();
    fixture.git(["config", "hook.other.command", "external-command"]);
    fixture.git(["config", "hook.other.event", "post-checkout"]);
    const traditionalHook = join(fixture.project.path, ".git", "hooks", "post-checkout");
    const script = "#!/bin/sh\nexit 0\n";
    await writeFile(traditionalHook, script, { mode: 0o755 });
    const config = join(fixture.project.path, ".git", "config");
    const before = await readFile(config, "utf8");
    const { integration, context } = await fixture.activate();

    await integration.reconcile(fixture.project, signal());

    expect(fixture.ownedKeys()).toEqual([]);
    expect(await readFile(config, "utf8")).toBe(before);
    expect(await readFile(traditionalHook, "utf8")).toBe(script);
    await expect(readdir(context.dataDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    expect(context.logger.debug).toHaveBeenCalledWith(expect.stringContaining("unavailable"), { projectId: fixture.project.id });
  });

  it.each([129, 0])("leaves unsupported named hooks alone (detection exit %s)", async (exitCode) => {
    const execFile = vi.fn<ServerPluginActivationContext["execFile"]>(() => Promise.resolve(result({ exitCode, stdout: "core.hooksPath\n" })));
    const context = activationContext({ execFile });
    const { integration } = await activate(context);
    await integration.reconcile({ id: "project", name: "Project", path: "/repo" }, signal());
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0]?.[0].args).toEqual(expect.arrayContaining(["help", "--config"]));
    expect(context.logger.debug).toHaveBeenCalledWith(expect.stringContaining("unavailable"), { projectId: "project" });
  });

  it.each([{ value: null }, { value: "true" }, { value: 1 }, { value: {} }, { value: [] }])("rejects malformed settings before mutation or accepting hints: $value", async ({ value }) => {
    const execFile = vi.fn<ServerPluginActivationContext["execFile"]>();
    const { integration } = await activate(activationContext({ execFile, settings: { workspaceDiscoveryHooks: value } }));
    const project = { id: "project", name: "Project", path: "/repo" };
    await expect(integration.reconcile(project, signal())).rejects.toThrow("must be a boolean");
    await expect(integration.acceptNotification(project, signal())).rejects.toThrow("must be a boolean");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("defaults on, honors resolved settings rather than remerging fixed snapshots, and forwards the invocation signal", async () => {
    const project = { id: "project", name: "Project", path: "/repo" };
    const defaultIntegration = (await activate(activationContext())).integration;
    await expect(defaultIntegration.acceptNotification(project, signal())).resolves.toBe(true);
    const resolver = vi.fn<NonNullable<ServerPluginActivationContext["resolveProjectSettings"]>>(() => Promise.resolve({ workspaceDiscoveryHooks: true }));
    const { integration } = await activate(activationContext({ settings: { workspaceDiscoveryHooks: false }, resolveProjectSettings: resolver }));
    const invocationSignal = signal();
    await expect(integration.acceptNotification(project, invocationSignal)).resolves.toBe(true);
    expect(resolver).toHaveBeenCalledWith(project, invocationSignal);
    const aborted = new AbortController();
    aborted.abort();
    await expect(integration.reconcile(project, aborted.signal)).rejects.toThrow();
  });
});

async function activate(context: ServerPluginActivationContext): Promise<{ provider: WorkspaceProvider; integration: WorkspaceProviderIntegration }> {
  const activation = await plugin.activate(context);
  const provider = activation.workspaceProvider;
  if (provider?.integration === undefined) throw new Error("Git integration was not exposed through workspaceProvider.integration");
  return { provider, integration: provider.integration };
}

function activationContext(overrides: Partial<ServerPluginActivationContext> = {}): ServerPluginActivationContext {
  return {
    apiVersion: 3, pluginId: "git", packageRoot: resolve("pi-web-plugins/git"), dataDirectory: "/unused/git-plugin-data",
    settings: {}, execFile: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    workspaceNotifications: { command: (projectId) => ["host-notifier", "--project", projectId] },
    signal: signal(), lifetimeSignal: signal(), ...overrides,
  };
}

async function repositoryFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-web-git-hooks-"));
  temporaryRoots.push(root);
  const path = join(root, "repo's quoted checkout");
  await mkdir(path);
  const globalConfig = join(root, "global config");
  const env = { ...gitEnvironment, GIT_CONFIG_GLOBAL: globalConfig };
  const git = (args: readonly string[]) => execFileSync("git", ["-C", path, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  const gitOutcome = (args: readonly string[]) => spawnSync("git", ["-C", path, ...args], { encoding: "utf8", env });
  git(["init", "-b", "main"]);
  await writeFile(join(path, "tracked.txt"), "tracked\n");
  git(["add", "."]);
  git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "initial"]);
  const project: ProjectInput = { id: "project ' with spaces", name: "Project", path };
  const log = join(root, "notification log");
  const recorder = join(root, "notification ' recorder.cjs");
  await writeFile(recorder, 'require("node:fs").appendFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)) + "\\n");\n');
  const expectedNotification = (projectId: string) => ["--daemon-target", "socket ' with spaces \" $`", "--project", projectId, ""];
  const execFile = vi.fn(createServerPluginExecFile({ env: {
    ...env, GIT_DIR: "/missing/poisoned-git-dir", GIT_WORK_TREE: "/missing/poisoned-worktree",
    GIT_CONFIG: "/missing/poisoned-config", GIT_CONFIG_COUNT: "99", GIT_CONFIG_PARAMETERS: "malformed",
  } }));
  const dataDirectory = join(root, "plugin's persistent data");
  const fixtureActivate = async (overrides: Partial<ServerPluginActivationContext> = {}) => {
    const context = activationContext({
      dataDirectory, execFile,
      workspaceNotifications: { command: (id) => [process.execPath, recorder, log, ...expectedNotification(id)] },
      ...overrides,
    });
    return { ...await activate(context), context };
  };
  const ownedKeys = () => {
    const outcome = gitOutcome(["config", "--local", "--name-only", "--get-regexp", "^hook\\.pi-web-workspace-discovery-.*\\.(command|event)$"]);
    // Exit 1 is Git's documented no-matching-key result, not a failed verification.
    if (outcome.status === 1) return [];
    if (outcome.status !== 0) throw new Error(`Unable to read owned keys: ${outcome.stderr}`);
    return outcome.stdout.trim().split("\n").filter(Boolean);
  };
  const runGit = (cwd: string, args: readonly string[], invocationSignal: AbortSignal) => execFile({
    file: "git", args: ["-C", cwd, ...args], unsetEnv: gitLocalEnvironmentKeys,
    timeoutMs: 10_000, signal: invocationSignal,
  });
  const helpers = async (directory: string) => (await readdir(join(directory, "workspace-discovery")))
    .filter((file) => file.endsWith(".cjs")).map((file) => join(directory, "workspace-discovery", file));
  return {
    root, project, globalConfig, git, gitOutcome, execFile, runGit, activate: fixtureActivate,
    ownedKeys, helpers,
    expectedNotification,
    async notifications(): Promise<unknown[]> {
      try { return (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map((line): unknown => JSON.parse(line)); }
      catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
    },
    async helper(directory: string): Promise<string> {
      const paths = await helpers(directory);
      if (paths.length !== 1 || paths[0] === undefined) throw new Error("Expected one helper");
      return paths[0];
    },
    async helperForProject(directory: string, id: string): Promise<string> {
      for (const helper of await helpers(directory)) {
        if ((await readFile(helper, "utf8")).includes(JSON.stringify(id))) return helper;
      }
      throw new Error("Expected project's helper");
    },
  };
}

function registrationMetadataPath(helper: string): string { return `${helper}.registration.json`; }
function registrationFiles(helpers: readonly string[]): string[] {
  return helpers.flatMap((helper) => [basename(helper), basename(registrationMetadataPath(helper))]).sort();
}
function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
function result(overrides: Partial<ServerPluginExecFileResult> = {}): ServerPluginExecFileResult {
  return { exitCode: 0, signal: null, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false, ...overrides };
}
