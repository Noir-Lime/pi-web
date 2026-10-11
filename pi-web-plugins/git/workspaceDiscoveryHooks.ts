import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
  ProjectInput,
  ServerPluginActivationContext,
  ServerPluginExecFileResult,
  WorkspaceProviderIntegration,
} from "@jmfederico/pi-web/server-plugin-api";

type RunGit = (cwd: string, args: readonly string[], signal: AbortSignal) => Promise<ServerPluginExecFileResult>;
interface ConfigValue { scope: string; value: string }
const EVENT = "post-checkout";

/** Git owns the hook policy; the host owns settings snapshots and notification attribution/transport. */
export function createWorkspaceDiscoveryHooks(
  context: ServerPluginActivationContext,
  runGit: RunGit,
  nodeExecutable = process.execPath,
): WorkspaceProviderIntegration {
  if (!isAbsolute(nodeExecutable)) throw new Error("Git hook runtime must be an absolute executable path");
  // Serialize this activation's config edits, including registrations sharing a
  // common Git config. Git itself locks writes from other processes.
  let pending = Promise.resolve();
  return Object.freeze({
    reconcile(project: ProjectInput, signal: AbortSignal): Promise<void> {
      const operation = pending.then(() => reconcile(project, signal));
      pending = operation.catch(() => { /* The caller still receives the failure; do not poison the queue. */ });
      return operation;
    },
    async acceptNotification(project: ProjectInput, signal: AbortSignal): Promise<boolean> {
      return await enabled(project, signal) && (context.workspaceNotifications?.command(project.id).length ?? 0) > 0;
    },
  });

  async function enabled(project: ProjectInput, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const settings = context.resolveProjectSettings === undefined
      ? context.settings
      : await context.resolveProjectSettings(project, signal);
    const value = settings["workspaceDiscoveryHooks"];
    if (value === undefined) return true;
    if (typeof value !== "boolean") throw new Error("Git setting workspaceDiscoveryHooks must be a boolean");
    return value;
  }

  async function reconcile(project: ProjectInput, signal: AbortSignal): Promise<void> {
    const isEnabled = await enabled(project, signal);
    // Include the persistent activation directory as well as the opaque project
    // id: separate registrations/daemons may share one repository.
    const identity = createHash("sha256")
      .update(JSON.stringify([context.pluginId, resolve(context.dataDirectory), project.id]))
      .digest("hex");
    const name = `pi-web-workspace-discovery-${identity}`;
    const helper = join(context.dataDirectory, "workspace-discovery", `${name}.cjs`);
    const registration = `${helper}.registration.json`;
    const command = registrationCommand(helper, nodeExecutable);
    const previousNode = await readRegistrationNode(registration, signal);
    const ownedCommands = new Set([command, ...(previousNode === undefined ? [] : [registrationCommand(helper, previousNode)])]);
    const notifier = isEnabled ? context.workspaceNotifications?.command(project.id) : undefined;
    const install = notifier !== undefined && notifier.length > 0;
    if (install && !await supportsNamedHooks(project, signal)) return;

    const commandKey = `hook.${name}.command`;
    const eventKey = `hook.${name}.event`;
    const commands = await readConfig(project, commandKey, signal);
    const events = await readConfig(project, eventKey, signal);
    if (commands.some((entry) => entry.scope !== "local" || !ownedCommands.has(entry.value))
      || events.some((entry) => entry.scope !== "local" || (entry.value !== EVENT && commands.length === 0))) {
      // We only install local keys. A same-name global/worktree registration is
      // external even if its values happen to match ours; never override it or
      // remove the local command on which its inherited event might depend.
      throw new Error(`Git workspace discovery hook conflict: ${name} has unexpected configuration`);
    }

    if (!install) {
      // Disconnect the event first: an event without a command makes Git fail.
      // Installation uses the reverse order for the same reason.
      await unsetLocal(project, eventKey, events, signal);
      await unsetLocal(project, commandKey, commands, signal);
      signal.throwIfAborted();
      await rm(helper, { force: true });
      await rm(registration, { force: true });
      return;
    }

    await writeOwnedFileIfChanged(helper, helperSource(notifier), signal);
    await setLocal(project, commandKey, command, commands, signal);
    await setLocal(project, eventKey, EVENT, events, signal);
    // Retain provenance across Node/version-manager upgrades. Only a command
    // targeting this exact helper with our current or recorded runtime is owned.
    await writeOwnedFileIfChanged(registration, `${JSON.stringify({ version: 1, nodeExecutable })}\n`, signal);
  }

  async function supportsNamedHooks(project: ProjectInput, signal: AbortSignal): Promise<boolean> {
    // Detect Git's advertised named-config facility, not its version. `hook
    // list` is unsuitable here: a missing command in an existing registration
    // makes it fail, preventing precisely the repair we need to perform.
    const result = await runGit(project.path, ["help", "--config"], signal);
    if (result.signal !== null) throw new Error(`Git named-hook detection ended from signal ${result.signal}`);
    const keys = result.stdout.split(/\r?\n/u);
    const supported = result.exitCode === 0
      && keys.includes("hook.<friendly-name>.command") && keys.includes("hook.<friendly-name>.event");
    if (!supported) context.logger.debug("Git named configuration hooks unavailable; workspace discovery remains on catalog access", { projectId: project.id });
    return supported;
  }

  async function readConfig(project: ProjectInput, key: string, signal: AbortSignal): Promise<ConfigValue[]> {
    const result = await runGit(project.path, ["config", "--null", "--show-scope", "--get-all", key], signal);
    if (result.signal === null && result.exitCode === 1) return [];
    requireSuccess(result, `read ${key}`);
    const fields = result.stdout.split("\0");
    if (fields.pop() !== "" || fields.length % 2 !== 0) throw new Error(`Malformed Git config output for ${key}`);
    const entries: ConfigValue[] = [];
    for (let index = 0; index < fields.length; index += 2) {
      entries.push({ scope: fields[index] ?? "", value: fields[index + 1] ?? "" });
    }
    return entries;
  }

  async function setLocal(project: ProjectInput, key: string, value: string, entries: ConfigValue[], signal: AbortSignal): Promise<void> {
    const local = entries.filter((entry) => entry.scope === "local");
    if (local.length === 1 && local[0]?.value === value) return;
    requireSuccess(await runGit(project.path, ["config", "--local", "--replace-all", key, value], signal), `set ${key}`);
  }

  async function unsetLocal(project: ProjectInput, key: string, entries: ConfigValue[], signal: AbortSignal): Promise<void> {
    if (!entries.some((entry) => entry.scope === "local")) return;
    requireSuccess(await runGit(project.path, ["config", "--local", "--unset-all", key], signal), `remove ${key}`);
  }
}

function requireSuccess(result: ServerPluginExecFileResult, action: string): void {
  if (result.signal === null && result.exitCode === 0) return;
  const outcome = result.signal === null ? `exit ${String(result.exitCode)}` : `signal ${result.signal}`;
  throw new Error(`Unable to ${action} (${outcome}): ${result.stderr.trim()}`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function registrationCommand(helper: string, nodeExecutable: string): string {
  // Git itself supplies the shell and appends quoted hook argv to the function
  // call. No extra `sh` executable is required on the user's PATH. The final
  // return preserves best-effort behavior even when our helper/runtime is gone.
  const shellHelper = process.platform === "win32" ? helper.replaceAll("\\", "/") : helper;
  const shellNode = process.platform === "win32" ? nodeExecutable.replaceAll("\\", "/") : nodeExecutable;
  return `pi_web_workspace_notify () { if test -r ${shellQuote(shellHelper)}; then ${shellQuote(shellNode)} ${shellQuote(shellHelper)} "$@" >/dev/null 2>&1; fi; return 0; }; pi_web_workspace_notify`;
}

async function readRegistrationNode(path: string, signal: AbortSignal): Promise<string | undefined> {
  let source: string;
  try {
    source = await readFile(path, { encoding: "utf8", signal });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  const value: unknown = JSON.parse(source);
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Reflect.get(value, "version") !== 1) throw new Error(`Invalid PI WEB Git hook registration record: ${path}`);
  const nodeExecutable: unknown = Reflect.get(value, "nodeExecutable");
  if (typeof nodeExecutable !== "string" || !isAbsolute(nodeExecutable)) {
    throw new Error(`Invalid PI WEB Git hook runtime record: ${path}`);
  }
  return nodeExecutable;
}

function helperSource(command: readonly string[]): string {
  return `// Generated by the PI WEB Git plugin. Best-effort discovery hint, never Git authority.
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
// Git worktree add's initial checkout has a null previous OID and branch flag 1.
// --no-checkout does not fire this hook; normal catalog listing still discovers it.
if (args.length === 3 && /^(?:0{40}|0{64})$/.test(args[0]) && args[2] === "1") {
  const command = ${JSON.stringify(command)};
  try {
    spawnSync(command[0], command.slice(1), { stdio: "ignore", timeout: 2000, killSignal: "SIGKILL" });
  } catch { /* Notification/daemon failure must not affect the Git operation. */ }
}
`;
}

async function writeOwnedFileIfChanged(path: string, source: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  try {
    if (await readFile(path, { encoding: "utf8", signal }) === source) return;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  // Unique temporary siblings + atomic rename avoid partial helpers and races
  // in the shared plugin data directory. Each registration has its own target.
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, source, { flag: "wx", mode: 0o600, signal });
    signal.throwIfAborted();
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
