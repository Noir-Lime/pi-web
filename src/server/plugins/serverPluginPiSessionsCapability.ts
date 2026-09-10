import {
  PI_WEB_HOST_PI_SESSIONS_CAPABILITY,
  type PiWebHostPiSessionRun,
  type PiWebHostPiSessionRunCompletion,
  type PiWebHostPiSessionRunInput,
  type PiWebHostPiSessionsV1,
} from "../../server-plugin-api.js";
import type { ProjectService } from "../projects/projectService.js";
import type { PiSessionRef } from "../sessions/piSessionService.js";
import type { WorkspaceProviderRegistry } from "../workspaces/workspaceProviderRegistry.js";
import type { ServerPluginHostCapabilityContext, ServerPluginHostCapabilityFactory } from "./serverPluginRuntime.js";
import { createServerPluginWorkspacesCapabilityFactory } from "./serverPluginWorkspacesCapability.js";

const DEFAULT_MAX_CONCURRENT_RUNS_PER_PLUGIN = 4;
const COMPLETION_ERROR_MAX_BYTES = 4 * 1024;

interface HostPiSessionService {
  startOneShotRun(
    cwd: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<{ readonly id: string; readonly completion: Promise<void> }>;
  abort(ref: PiSessionRef): Promise<void>;
  stop(ref: PiSessionRef): Promise<void>;
}

export interface CreateServerPluginPiSessionsCapabilityOptions {
  readonly projects: Pick<ProjectService, "requireProject">;
  readonly workspaces: Pick<WorkspaceProviderRegistry, "resolve">;
  readonly sessions: HostPiSessionService;
  /** Test/host tuning seam; production uses the conservative default. */
  readonly maxConcurrentRunsPerPlugin?: number;
}

interface RunAdmission {
  cancelled: boolean;
  cleaningUp: boolean;
  ref?: PiSessionRef;
  abort?: Promise<void>;
  readonly settled: Promise<void>;
  settle(): void;
}

/** Creates package-attributed one-shot PI session admission over host-owned services. */
export function createServerPluginPiSessionsCapabilityFactory(
  options: CreateServerPluginPiSessionsCapabilityOptions,
): ServerPluginHostCapabilityFactory<PiWebHostPiSessionsV1> {
  const maxConcurrentRuns = positiveInteger(
    options.maxConcurrentRunsPerPlugin,
    DEFAULT_MAX_CONCURRENT_RUNS_PER_PLUGIN,
    "maxConcurrentRunsPerPlugin",
  );
  const workspaceFactory = createServerPluginWorkspacesCapabilityFactory(options);

  return Object.freeze({
    capability: PI_WEB_HOST_PI_SESSIONS_CAPABILITY,
    create(context: ServerPluginHostCapabilityContext) {
      const workspaceAuthority = workspaceFactory.create(context).value;
      const admissions = new Set<RunAdmission>();
      const cleanupFailures: unknown[] = [];
      let revoked = false;

      const abortAdmission = (admission: RunAdmission): Promise<void> | undefined => {
        const ref = admission.ref;
        if (ref === undefined || admission.cleaningUp) return admission.abort;
        admission.abort ??= options.sessions.abort(ref);
        void admission.abort.catch(() => undefined);
        return admission.abort;
      };

      const revoke = (): void => {
        if (revoked) return;
        revoked = true;
        for (const admission of admissions) {
          admission.cancelled = true;
          void abortAdmission(admission);
        }
      };

      const lifetimeAbort = (): void => { revoke(); };
      if (context.lifetimeSignal.aborted) revoke();
      else context.lifetimeSignal.addEventListener("abort", lifetimeAbort, { once: true });

      const value: PiWebHostPiSessionsV1 = Object.freeze({
        version: 1,
        run: async (input: PiWebHostPiSessionRunInput): Promise<PiWebHostPiSessionRun> => {
          assertActive(context, revoked);
          if (admissions.size >= maxConcurrentRuns) {
            throw capabilityError(
              context.pluginId,
              `reached its limit of ${String(maxConcurrentRuns)} concurrent runs`,
            );
          }

          const admission = createAdmission();
          admissions.add(admission);
          let handedOffCompletion = false;
          try {
            const authority = await workspaceAuthority.resolve({
              projectId: input.projectId,
              workspaceId: input.workspaceId,
            });
            assertActive(context, revoked || admission.cancelled);

            let started: { readonly id: string; readonly completion: Promise<void> };
            try {
              started = await options.sessions.startOneShotRun(
                authority.workspace.path,
                input.prompt,
                context.lifetimeSignal,
              );
            } catch (error) {
              if (revoked || admission.cancelled || context.lifetimeSignal.aborted) {
                throw revokedError(context, error);
              }
              throw capabilityError(context.pluginId, "could not start a PI session", error);
            }
            admission.ref = Object.freeze({ id: started.id, cwd: authority.workspace.path });

            if (revoked || admission.cancelled) {
              admission.cancelled = true;
              void abortAdmission(admission);
              await cleanupBeforeHandle(options.sessions, admission, cleanupFailures, context.pluginId);
              throw revokedError(context);
            }

            const completion = completeRun(
              options.sessions,
              admission,
              started.completion,
              cleanupFailures,
            )
              .finally(() => {
                admissions.delete(admission);
                admission.settle();
              });
            handedOffCompletion = true;
            return Object.freeze({ sessionId: started.id, completion });
          } finally {
            if (!handedOffCompletion) {
              admissions.delete(admission);
              admission.settle();
            }
          }
        },
      });

      return Object.freeze({
        value,
        async dispose(signal: AbortSignal): Promise<void> {
          revoke();
          context.lifetimeSignal.removeEventListener("abort", lifetimeAbort);
          await waitForSettled([...admissions].map(({ settled }) => settled), signal);
          if (cleanupFailures.length === 1) throw cleanupFailures[0];
          if (cleanupFailures.length > 1) {
            throw new AggregateError(cleanupFailures, `PI WEB host PI session cleanup failed for server plugin ${context.pluginId}`);
          }
        },
      });
    },
  });
}

async function completeRun(
  sessions: HostPiSessionService,
  admission: RunAdmission,
  runCompletion: Promise<void>,
  cleanupFailures: unknown[],
): Promise<PiWebHostPiSessionRunCompletion> {
  const ref = admission.ref;
  if (ref === undefined) throw new Error("PI WEB host PI session admission has no session identity");

  let completion: PiWebHostPiSessionRunCompletion;
  try {
    if (admission.cancelled) completion = Object.freeze({ status: "cancelled" });
    else {
      await runCompletion;
      completion = Object.freeze({ status: admissionWasCancelled(admission) ? "cancelled" : "completed" });
    }
  } catch (error) {
    completion = admission.cancelled
      ? Object.freeze({ status: "cancelled" })
      : failedCompletion(error);
  }

  if (admission.cancelled) {
    try {
      await admission.abort;
    } catch (error) {
      cleanupFailures.push(error);
      completion = failedCompletion(error);
    }
  }

  admission.cleaningUp = true;
  try {
    await sessions.stop(ref);
  } catch (error) {
    cleanupFailures.push(error);
    completion = failedCompletion(error);
  }
  return completion;
}

async function cleanupBeforeHandle(
  sessions: HostPiSessionService,
  admission: RunAdmission,
  cleanupFailures: unknown[],
  pluginId: string,
): Promise<void> {
  const ref = admission.ref;
  if (ref === undefined) return;
  try {
    await admission.abort;
  } catch (error) {
    cleanupFailures.push(error);
  }
  admission.cleaningUp = true;
  try {
    await sessions.stop(ref);
  } catch (error) {
    cleanupFailures.push(error);
    throw capabilityError(pluginId, "could not clean up a cancelled PI session", error);
  }
}

function createAdmission(): RunAdmission {
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => { settle = resolve; });
  return { cancelled: false, cleaningUp: false, settled, settle };
}

function admissionWasCancelled(admission: RunAdmission): boolean {
  return admission.cancelled;
}

function failedCompletion(error: unknown): PiWebHostPiSessionRunCompletion {
  const message = error instanceof Error ? error.message : String(error);
  return Object.freeze({
    status: "failed",
    error: truncateUtf8(message === "" ? "PI session run failed" : message, COMPLETION_ERROR_MAX_BYTES),
  });
}

function assertActive(context: ServerPluginHostCapabilityContext, revoked: boolean): void {
  if (!revoked && !context.lifetimeSignal.aborted) return;
  throw revokedError(context);
}

function revokedError(context: ServerPluginHostCapabilityContext, cause: unknown = context.lifetimeSignal.reason): Error {
  return capabilityError(context.pluginId, "is no longer active", cause);
}

function capabilityError(pluginId: string, message: string, cause?: unknown): Error {
  return new Error(
    `PI WEB host PI session authority for server plugin ${pluginId} ${message}`,
    cause === undefined ? {} : { cause },
  );
}

async function waitForSettled(operations: readonly Promise<void>[], signal: AbortSignal): Promise<void> {
  if (operations.length === 0) return;
  if (signal.aborted) throw abortError(signal);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => { reject(abortError(signal)); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([Promise.allSettled(operations), aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("PI WEB host PI session cleanup was aborted", "AbortError");
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(`${label} must be a positive integer`);
  return resolved;
}

function truncateUtf8(value: string, maxBytes: number): string {
  let bytes = 0;
  let output = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const width = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes + width > maxBytes) break;
    output += character;
    bytes += width;
  }
  return output === "" ? "PI session run failed" : output;
}
