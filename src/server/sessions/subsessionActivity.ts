/**
 * Pure live-activity view of a working subsession, derived from its normalized
 * history. It exposes WHAT the child is doing (tool names, one-line summaries,
 * timing, repeats) and never assistant prose, thinking, or tool output.
 */

export interface ActivityCall {
  /** Position of the assistant message holding the call in the full history. */
  index: number;
  toolName: string;
  summary: string;
  /** Epoch ms of the assistant message that issued the call, when recorded. */
  at?: number;
  state: "running" | "done" | "error";
}

export interface ActivityRepeat {
  toolName: string;
  summary: string;
  /** Length of the trailing run of identical calls (same tool and arguments). */
  count: number;
}

export interface SubsessionActivity {
  /** Most recent calls, chronological, at most the requested limit. */
  calls: ActivityCall[];
  /** Calls issued in the whole history. */
  totalCalls: number;
  /** Calls with no result yet. */
  running: number;
  /** Epoch ms of the newest timestamped history message. */
  lastActivityAt?: number;
  /** Trailing run of identical calls, only when count >= REPEAT_THRESHOLD. */
  repeat?: ActivityRepeat;
}

export const DEFAULT_ACTIVITY_CALLS = 8;
export const MAX_ACTIVITY_CALLS = 50;
/** Three identical calls in a row is the smallest run worth flagging as polling. */
export const REPEAT_THRESHOLD = 3;

interface RawCall extends ActivityCall {
  id?: string;
  key: string;
}

export function buildSubsessionActivity(messages: readonly unknown[], limit = DEFAULT_ACTIVITY_CALLS): SubsessionActivity {
  const cap = Math.max(1, Math.min(MAX_ACTIVITY_CALLS, Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_ACTIVITY_CALLS));
  const calls: RawCall[] = [];
  const byId = new Map<string, RawCall>();
  let lastActivityAt: number | undefined;
  messages.forEach((message, index) => {
    const at = num(prop(message, "timestamp"));
    if (at !== undefined && (lastActivityAt === undefined || at > lastActivityAt)) lastActivityAt = at;
    const role = str(message, "role");
    if (role === "assistant") {
      const content = prop(message, "content");
      if (!Array.isArray(content)) return;
      for (const part of content) {
        if (str(part, "type") !== "toolCall") continue;
        const args = prop(part, "arguments");
        const id = str(part, "id");
        const call: RawCall = {
          index,
          toolName: str(part, "name") ?? "tool",
          summary: summarize(args),
          ...(at === undefined ? {} : { at }),
          state: "running",
          ...(id === undefined ? {} : { id }),
          key: `${str(part, "name") ?? "tool"}\u0000${stable(args)}`,
        };
        calls.push(call);
        if (id !== undefined) byId.set(id, call);
      }
    } else if (role === "toolResult") {
      const id = str(message, "toolCallId");
      const call = id === undefined ? undefined : byId.get(id);
      if (call !== undefined) call.state = prop(message, "isError") === true ? "error" : "done";
    }
  });
  let run = 0;
  const last = calls.at(-1);
  for (let i = calls.length - 1; i >= 0 && last !== undefined && calls[i]?.key === last.key; i--) run += 1;
  return {
    calls: calls.slice(-cap).map(({ index, toolName, summary, at, state }) => ({ index, toolName, summary, ...(at === undefined ? {} : { at }), state })),
    totalCalls: calls.length,
    running: calls.filter((call) => call.state === "running").length,
    ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
    ...(last !== undefined && run >= REPEAT_THRESHOLD ? { repeat: { toolName: last.toolName, summary: last.summary, count: run } } : {}),
  };
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${String(s)}s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${String(m)}m` : `${String(Math.round(m / 60))}h`;
}

/** Model-facing rendering. `render` escapes identity-style data (tool names, summaries). */
export function renderSubsessionActivity(activity: SubsessionActivity, nowMs: number, render: (value: string) => string): string {
  const lines: string[] = [];
  lines.push(activity.lastActivityAt === undefined
    ? "Last recorded activity: unknown."
    : `Last recorded activity: ${ago(nowMs - activity.lastActivityAt)} ago. A long gap with a running call means a slow tool or a stall; a short gap means it is progressing.`);
  lines.push(`Tool calls so far: ${String(activity.totalCalls)}; running now: ${String(activity.running)}.`);
  if (activity.repeat !== undefined) {
    lines.push(`REPEAT: the last ${String(activity.repeat.count)} calls are identical: ${render(activity.repeat.toolName)} ${render(activity.repeat.summary)}. Likely polling or a loop; consider steering it.`);
  }
  if (activity.calls.length > 0) {
    lines.push(`Last ${String(activity.calls.length)} calls (oldest first; output, prose and thinking are not shown):`);
    for (const call of activity.calls) {
      const when = call.at === undefined ? "" : `${ago(nowMs - call.at)} ago `;
      lines.push(`- #${String(call.index)} ${when}[${call.state}] ${render(call.toolName)} ${render(call.summary)}`);
    }
  }
  return lines.join("\n");
}

function summarize(args: unknown): string {
  if (!isRec(args)) return typeof args === "string" ? clipTo(args) : "";
  const command = str(args, "command");
  if (command !== undefined) return clipTo(command);
  const path = str(args, "path");
  if (path !== undefined) return clipTo(path);
  if (Array.isArray(args["edits"])) return `${String(args["edits"].length)} edits`;
  const entries = Object.entries(args).filter(([, value]) => value != null).slice(0, 3);
  return clipTo(entries.map(([key, value]) => `${key}: ${typeof value === "string" ? value : typeof value === "object" ? "object" : String(value)}`).join(" · "));
}

function clipTo(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
}

function stable(value: unknown): string {
  try {
    const json: unknown = JSON.stringify(value, (_key, v: unknown) => (isRec(v) && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
    return typeof json === "string" ? json : "";
  } catch {
    return "";
  }
}

function isRec(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function prop(value: unknown, key: string): unknown {
  return isRec(value) ? value[key] : undefined;
}
function str(value: unknown, key: string): string | undefined {
  const p = prop(value, key);
  return typeof p === "string" ? p : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
