import { randomUUID } from "node:crypto";
import type { PiWebHostPiSessionConnection } from "../../server-plugin-api.js";

export interface SubsessionBackgroundJob {
  id: string;
  kind: "background" | "monitor";
  command: string;
  logpath: string;
  pid: number | null;
  startedAt: string;
}

export interface SubsessionBackgroundJobs {
  version: 1;
  observedAt: string;
  jobs: SubsessionBackgroundJob[];
}

export function parseSubsessionBackgroundJobs(value: unknown): SubsessionBackgroundJobs | undefined {
  if (!record(value) || value["version"] !== 1 || !date(value["observedAt"]) || !Array.isArray(value["jobs"])) return undefined;
  const jobs: SubsessionBackgroundJob[] = [];
  for (const job of value["jobs"]) {
    if (!record(job) || typeof job["id"] !== "string" || (job["kind"] !== "background" && job["kind"] !== "monitor")
      || typeof job["command"] !== "string" || typeof job["logpath"] !== "string" || !date(job["startedAt"])
      || (job["pid"] !== null && (typeof job["pid"] !== "number" || !Number.isInteger(job["pid"]) || job["pid"] <= 0))) return undefined;
    jobs.push({ id: job["id"], kind: job["kind"], command: job["command"], logpath: job["logpath"], pid: job["pid"], startedAt: job["startedAt"] });
  }
  return { version: 1, observedAt: value["observedAt"], jobs };
}

/** The per-session event bus invokes handlers synchronously; no reply means unknown. */
export function querySubsessionBackgroundJobs(connect: (lifetime: AbortSignal) => PiWebHostPiSessionConnection): SubsessionBackgroundJobs | undefined {
  const lifetime = new AbortController();
  let connection: PiWebHostPiSessionConnection | undefined;
  let result: SubsessionBackgroundJobs | undefined;
  try {
    connection = connect(lifetime.signal);
    const requestId = randomUUID();
    connection.on("bash-background:snapshot-v1", (reply) => {
      if (record(reply) && reply["requestId"] === requestId) result = parseSubsessionBackgroundJobs(reply["snapshot"]);
    });
    connection.emit("bash-background:query-v1", { requestId });
    return result;
  } catch {
    return undefined;
  } finally {
    connection?.close();
    lifetime.abort();
  }
}

export function renderSubsessionBackgroundJobs(snapshot: SubsessionBackgroundJobs | undefined, render: (text: string) => string): string {
  if (snapshot === undefined) return "Background jobs: unknown (no live extension response).";
  if (snapshot.jobs.length === 0) return "Background jobs: none running.";
  return [`Running background jobs (observed ${snapshot.observedAt}):`, ...snapshot.jobs.map((job) => {
    const command = job.command.length > 300 ? `${job.command.slice(0, 300)}… [command truncated; inspect the original tool call for full text]` : job.command;
    return `- ${render(job.id)} [${job.kind}] PID ${job.pid === null ? "unknown" : String(job.pid)}, started ${job.startedAt}: ${render(command)}; log ${render(job.logpath)}`;
  })].join("\n");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function date(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
