import { Type } from "pi-web-typebox";
import { renderSubsessionBackgroundJobs, type SubsessionBackgroundJobs } from "./subsessionBackgroundJobs.js";
import { KNOWN_THINKING_LEVELS } from "../../shared/thinkingLevels.js";
import { defineTool, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { requireInitialSessionName } from "./sessionNameGenerator.js";
import type { TranscriptContentKind, TranscriptEntry, TranscriptRole, TranscriptView } from "./subsessionTranscript.js";
import type { SubsessionCompletion } from "./subsessionCompletionInbox.js";
import { DEFAULT_ACTIVITY_CALLS, MAX_ACTIVITY_CALLS, renderSubsessionActivity, type SubsessionActivity } from "./subsessionActivity.js";

/** Lifecycle phase of a tracked subsession as seen by its parent. */
export type SubsessionStatus = "working" | "idle" | "error" | "unknown";

/** Cumulative session token accounting, as in SessionStatus.tokens. Not context occupancy. */
export interface SubsessionTokens { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }

/** SDK context estimate, not exact occupancy or cumulative usage. Keep the unmodified SDK pair. */
export interface SubsessionContextUsage { tokens: number | null; contextWindow: number; percent: number | null }

/**
 * Optional runtime identity/usage snapshot for one child. Every field is
 * absent when unknown (for example a persisted child that is not loaded);
 * absent means unknown, never zero.
 */
export interface SubsessionObservation {
  /** Configured/resolved model as `provider/id`; not a response-model claim. */
  model?: string;
  thinkingLevel?: string;
  /** Cumulative session usage. */
  tokens?: SubsessionTokens;
  /** Context occupancy at observation time. */
  contextUsage?: SubsessionContextUsage;
  observedAt?: string;
  /** ISO time of the newest recorded history message; present only for a working child. */
  lastActivityAt?: string;
}

export interface SpawnSubsessionResult {
  sessionId: string;
  cwd: string;
  /** Explicit spawn name, when one was given. */
  name?: string;
  /** Model the child session runs with, as `provider/id`; absent when unknown. */
  model?: string;
  /** Actual thinking level after clamping to the child model's capabilities. */
  thinkingLevel?: string;
}

export type SpawnSubsessionModel = NonNullable<ExtensionContext["model"]>;
export type SpawnSubsessionThinkingLevel = NonNullable<ExtensionContext["thinkingLevel"]>;

export interface SpawnSubsessionInvocation {
  /**
   * cwd of the session that invoked the tool, used for project-scope validation.
   */
  spawningCwd: string;
  /** Session id of the parent; the spawned session is tracked against it. */
  parentSessionId: string;
  /** Session file of the parent, recorded in the child's `parentSession` header. */
  parentSessionFile: string | undefined;
  prompt: string;
  /** Optional explicit session name; validated with the ordinary session-naming rules. */
  name?: string;
  /** Optional target workspace in the parent's registered project. Defaults to spawningCwd. */
  cwd?: string;
  /** Current model from the dispatching session, used as the spawned session's default. */
  model?: SpawnSubsessionModel;
  /** Strict `provider/model-id` requested by the parent; overrides {@link model} when set. */
  modelSpec?: string;
  /** Explicit override or parent's inherited thinking level (pi clamps it to the child model's capabilities). */
  thinkingLevel?: SpawnSubsessionThinkingLevel;
}

export interface SubsessionSummary extends SubsessionObservation {
  sessionId: string;
  cwd: string;
  status: SubsessionStatus;
  name?: string;
}

/** Quick glance at a subsession: status plus its most recent assistant output. */
export interface SubsessionCheckResult extends SubsessionObservation {
  sessionId: string;
  cwd: string;
  status: SubsessionStatus;
  name?: string;
  finalText: string;
  messageCount: number;
  /** Live extension-owned jobs; absent means unknown, not an empty registry. */
  backgroundJobs?: SubsessionBackgroundJobs;
  errorDetail?: string;
  /** Live tool-call activity; present only while the child is working. */
  activity?: SubsessionActivity;
}

export interface SubsessionJoinResult {
  subsessions: SubsessionSummary[];
  completions: SubsessionCompletion[];
}

/** Exploratory transcript read: a filtered, paginated slice of the subsession's history. */
export interface SubsessionReadResult extends TranscriptView {
  /** Live extension-owned jobs; absent means unknown. */
  backgroundJobs?: SubsessionBackgroundJobs;
  sessionId: string;
  cwd: string;
  status: SubsessionStatus;
  name?: string;
  errorDetail?: string;
  /** Live tool-call activity; present only while the child is working. */
  activity?: SubsessionActivity;
}

/** Filters the parent passes to narrow a transcript read; mirrors {@link TranscriptQuery}. */
export interface SubsessionReadQuery {
  roles?: TranscriptRole[];
  include?: TranscriptContentKind[];
  search?: string;
  maxChars?: number;
  includeToolArgs?: boolean;
  before?: number;
  limit?: number;
}

export interface SubsessionToolDeps {
  rename(parentSessionId: string, sessionId: string, name: string, parentSessionFile?: string): Promise<void>;
  setModel(parentSessionId: string, sessionId: string, model: string, parentSessionFile?: string): Promise<SubsessionObservation>;
  setThinkingLevel(parentSessionId: string, sessionId: string, level: string, parentSessionFile?: string): Promise<SubsessionObservation>;
  sendParent(childSessionId: string, message: string, childSessionFile?: string, mode?: "queue" | "steer"): Promise<void>;
  stop(parentSessionId: string, sessionId: string, parentSessionFile?: string): Promise<void>;
  send(parentSessionId: string, sessionId: string, message: string, parentSessionFile?: string, mode?: "queue" | "steer"): Promise<void>;
  spawn(input: SpawnSubsessionInvocation): Promise<SpawnSubsessionResult>;
  list(parentSessionId: string, parentSessionFile?: string): Promise<SubsessionSummary[]>;
  join(parentSessionId: string, parentSessionFile?: string, toolCallId?: string): Promise<SubsessionJoinResult>;
  check(parentSessionId: string, sessionId: string, parentSessionFile?: string, toolCallId?: string, activityCalls?: number): Promise<SubsessionCheckResult>;
  read(parentSessionId: string, sessionId: string, query: SubsessionReadQuery, parentSessionFile?: string, toolCallId?: string): Promise<SubsessionReadResult>;
}

const SpawnSubsessionParams = Type.Object({
  cwd: Type.Optional(Type.String({
    description: "Working directory for the child. Must be a workspace (worktree, or root) of the same registered project. Defaults to this session's working directory.",
  })),
  name: Type.Optional(Type.String({
    description: "Optional name for the child session, shown as a quoted name followed by (id) in spawn/list/check/read results and completion notices. Must be trimmed, non-empty, at most 60 characters, and contain no control characters (the ordinary session-naming rules). Duplicate names are allowed; the id remains the identity.",
  })),
  thinkingLevel: Type.Optional(Type.Enum(KNOWN_THINKING_LEVELS, {
    type: "string",
    description: "Thinking level override for the child session. Set this field only when instructed to use a specific thinking level or to choose an appropriate one. Otherwise omit it to inherit this session's thinking level. An unknown value is rejected; valid levels are clamped to the selected model's capabilities.",
  })),
  prompt: Type.String({
    description: "Initial instruction for the tracked child.",
  }),
  model: Type.Optional(Type.String({
    description: 'Model override for the child session, as an exact "provider/model-id". Set this field only when instructed to use a specific model or to choose an appropriate one. Otherwise omit it to inherit this session\'s model. An unknown value is rejected.',
  })),
});

const UpdateSubsessionParams = Type.Object({
  sessionId: Type.String({ description: "Your direct tracked child id." }),
  name: Type.Optional(Type.String({ description: "New display name, using the ordinary session-naming rules. Allowed while the child is working." })),
  model: Type.Optional(Type.String({ description: 'Exact "provider/model-id". Requires an idle child and preserves history. Applied before thinkingLevel and name; if a later step fails this model change is NOT rolled back.' })),
  thinkingLevel: Type.Optional(Type.Enum(KNOWN_THINKING_LEVELS, {
    description: "Explicit level, not a relative increase. Requires an idle child. Applied after model, before name. Unsupported levels are rejected, not clamped; an already-applied model change remains. Omit to keep the current level (which a model change may clamp).",
  })),
});
const ListSubsessionsParams = Type.Object({
  status: Type.Optional(Type.Array(
    Type.Union([Type.Literal("working"), Type.Literal("idle"), Type.Literal("error"), Type.Literal("unknown")]),
    { description: "Agent status filter. Omit or pass [] for all. idle does not mean its detached jobs have finished; unknown can mean the runtime is unloaded, not broken." },
  )),
  name: Type.Optional(Type.String({ description: "Case-insensitive name substring, not an ID lookup. A nonempty filter excludes unnamed children; omit or use an empty string for all names." })),
  compact: Type.Optional(Type.Boolean({ description: "One short line per child (name, status, estimated context tokens/current window, last activity, id) after a count-by-status header. Omits cwd, model and cumulative token detail." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, description: "Rendered text only: maximum matching rows, with working first, then error, idle, unknown. Omit for ALL matches, not a small default. Header counts are before this limit; structured details still contain all tracked rows." })),
});
const SendParentMessageParams = Type.Object({
  message: Type.String({ minLength: 1, description: "Progress update, question, or finding for your parent session." }),
});
const SendSubsessionMessageParams = Type.Object({
  sessionId: Type.String({ description: "Tracked child id from spawn_subsession or list_subsessions." }),
  message: Type.String({ minLength: 1, description: "Follow-up instruction or question for the existing child conversation." }),
});

/** Default per-value clip in transcript mode, so a careless call cannot pull an unbounded transcript. */
const TRANSCRIPT_DEFAULT_MAX_CHARS = 4000;

const CheckSubsessionParams = Type.Object({
  sessionId: Type.String({
    description: "Tracked child id from spawn_subsession or list_subsessions.",
  }),
  calls: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: MAX_ACTIVITY_CALLS,
    description: `Summary mode only: recent tool-call count (default ${String(DEFAULT_ACTIVITY_CALLS)}, max ${String(MAX_ACTIVITY_CALLS)}), also available for idle/error children. Ignored in transcript mode; working transcript requests use the default activity count.`,
  })),
  roles: Type.Optional(Type.Array(
    Type.Union([Type.Literal("assistant"), Type.Literal("user"), Type.Literal("tool"), Type.Literal("system"), Type.Literal("custom")]),
    { description: "Selects transcript mode. Recorded-history roles, not the child's system prompt or live retry buffer. Omit for all roles; [] matches none. Does not unlock a working transcript." },
  )),
  include: Type.Optional(Type.Array(
    Type.Union([Type.Literal("text"), Type.Literal("thinking"), Type.Literal("tool_call"), Type.Literal("tool_result"), Type.Literal("image")]),
    { description: "Selects transcript mode. Keep these content parts before search/pagination. Omit for all kinds; [] matches none. Images are placeholders, not image data." },
  )),
  search: Type.Optional(Type.String({
    description: "Selects transcript mode. Case-insensitive substring over retained content, tool names and full serialized arguments before clipping. Empty string adds no search filter. A hit may be hidden by display summaries/clipping; request raw arguments or increase maxChars to inspect it.",
  })),
  maxChars: Type.Optional(Type.Integer({
    minimum: 0,
    description: `Selects transcript mode. Characters per text/thinking/tool-result value (default ${String(TRANSCRIPT_DEFAULT_MAX_CHARS)}, 0 hides those values); increase explicitly for longer text. NOT a total-output cap: tool-call summaries, raw args and error headers are not clipped by it. A clipped final answer alone is not acknowledged.`,
  })),
  includeToolArgs: Type.Optional(Type.Boolean({
    description: "Selects transcript mode even when false. Default false; true includes complete serialized arguments, which maxChars does NOT bound and which can be large. Compact argument summaries remain either way.",
  })),
  before: Type.Optional(Type.Integer({
    minimum: 0,
    description: "Selects transcript mode. Exclusive original-message index, not a matching-row count. Use the previous start to page backward. An empty page with matches outside it may require raising/omitting before rather than paging further back.",
  })),
  limit: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 50,
    description: "Selects transcript mode. Return the newest matching messages before the cursor, oldest first within the page. Default and maximum 50. Filters run before pagination; matched counts the whole history, not just this page.",
  })),
});

/** Maximum rendered characters (excluding quotes) for one metadata value. */
const METADATA_RENDER_LIMIT = 120;

/** Code points that are invisible or can reorder text: Cc, Cf, Zl, Zp. */
const INVISIBLE_CODE_POINT = /\p{Cc}|\p{Cf}|\p{Zl}|\p{Zp}/u;

/**
 * The one bounded, escaped formatter for identity metadata in model-facing
 * text. Values are data, never raw notice text: quotes/backslashes are
 * escaped; control/format/line-separator code points (Cc, Cf, Zl, Zp,
 * including bidi controls, zero-width characters, and tag characters)
 * become `\uXXXX` (BMP) or `\u{XXXXX}` (supplementary) literals; and the
 * rendered value is bounded to 120 code points without splitting a
 * surrogate pair or an escape sequence. Ordinary Unicode (accents, CJK,
 * emoji) is preserved, except that a ZWJ inside an emoji sequence is Cf
 * and is escaped. Raw stored values are unchanged.
 */
export function formatMetadataText(value: string): string {
  const units: string[] = [];
  let total = 0;
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    let unit: string;
    if (ch === "\\") unit = "\\\\";
    else if (ch === '"') unit = '\\"';
    else if (INVISIBLE_CODE_POINT.test(ch)) unit = cp <= 0xffff ? `\\u${cp.toString(16).padStart(4, "0")}` : `\\u{${cp.toString(16)}}`;
    else unit = ch;
    units.push(unit);
    // Escape units are pure ASCII, so .length is their code-point count; a
    // plain unit is exactly one code point.
    total += unit.startsWith("\\") ? unit.length : 1;
  }
  if (total <= METADATA_RENDER_LIMIT) return `"${units.join("")}"`;
  let rendered = "";
  let used = 0;
  for (const unit of units) {
    const length = unit.startsWith("\\") ? unit.length : 1;
    if (used + length > METADATA_RENDER_LIMIT - 1) break; // never cut inside an escape
    rendered += unit;
    used += length;
  }
  return `"${rendered}…"`;
}

/** `"name" (id)` when a name is present, plain id otherwise. The name is quoted data. */
export function subsessionDisplay(sessionId: string, name?: string): string {
  return name === undefined || name === "" ? sessionId : `${formatMetadataText(name)} (${sessionId})`;
}

/** Model-facing one-line identity/usage label; cumulative tokens and context occupancy stay distinct. */
export function observationLine(observation: SubsessionObservation): string {
  const parts: string[] = [];
  if (observation.model !== undefined) parts.push(`model ${formatMetadataText(observation.model)}`);
  if (observation.thinkingLevel !== undefined) parts.push(`thinking level ${formatMetadataText(observation.thinkingLevel)}`);
  if (observation.tokens !== undefined) {
    const t = observation.tokens;
    parts.push(`cumulative tokens ${String(t.total)} total (input ${String(t.input)}, output ${String(t.output)}, cache read ${String(t.cacheRead)}, cache write ${String(t.cacheWrite)})`);
  }
  if (observation.contextUsage !== undefined) {
    parts.push(contextUsageLabel(observation.contextUsage));
  }
  if (observation.observedAt !== undefined) parts.push(`observed at ${observation.observedAt}`);
  return parts.join("; ");
}

/** One display contract for checks, compact lists and completion snapshots. No rounding or clamping. */
export function contextUsageLabel(context: SubsessionContextUsage): string {
  return `context ${context.tokens === null ? "unknown" : String(context.tokens)} of ${String(context.contextWindow)} tokens (SDK estimate)`;
}

function statusLine(summary: SubsessionSummary): string {
  const observed = observationLine(summary);
  return `- ${subsessionDisplay(summary.sessionId, summary.name)} [${summary.status}] in ${summary.cwd}${observed === "" ? "" : ` — ${observed}`}`;
}

function workingInspectionGuidance(sessionId: string, name?: string, activity?: SubsessionActivity): string {
  const tail = "Continue other work, or end your turn with a brief close-out message. Completion notices wake you; do not poll.";
  if (activity === undefined) return `Subsession ${subsessionDisplay(sessionId, name)} is working; partial output is withheld. ${tail}`;
  return `Subsession ${subsessionDisplay(sessionId, name)} is working; its output and transcript text are withheld, but its tool activity and bounded system/custom/provider evidence are shown below.\n\n${renderSubsessionActivity(activity, Date.now(), formatMetadataText)}\n\n${tail}`;
}

function agoText(iso: string | undefined, now: number): string {
  const t = iso === undefined ? Number.NaN : Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 90 ? `${String(s)}s ago` : s < 5400 ? `${String(Math.round(s / 60))}m ago` : `${String(Math.round(s / 3600))}h ago`;
}

function compactLine(summary: SubsessionSummary, now: number): string {
  const context = summary.contextUsage;
  const parts = [`[${summary.status}]`, ...(context === undefined ? [] : [contextUsageLabel(context)]), ...(summary.lastActivityAt === undefined ? [] : [`active ${agoText(summary.lastActivityAt, now)}`])];
  return `- ${subsessionDisplay(summary.sessionId, summary.name)} ${parts.join(" ")}`;
}

/** Filter, order (working first) and render a child listing. Pure; `now` is injected for tests. */
export function renderSubsessionList(all: readonly SubsessionSummary[], filter: { status?: readonly SubsessionStatus[]; name?: string; compact?: boolean; limit?: number }, now: number): string {
  const needle = filter.name?.toLowerCase();
  const matches = all.filter((s) => (filter.status === undefined || filter.status.length === 0 || filter.status.includes(s.status))
    && (needle === undefined || needle === "" || (s.name?.toLowerCase().includes(needle) ?? false)));
  const rank = (s: SubsessionSummary) => (s.status === "working" ? 0 : s.status === "error" ? 1 : s.status === "idle" ? 2 : 3);
  const ordered = [...matches].sort((a, b) => rank(a) - rank(b));
  const shown = filter.limit === undefined ? ordered : ordered.slice(0, filter.limit);
  const counts = (["working", "idle", "error", "unknown"] as const).map((k) => `${k} ${String(matches.filter((s) => s.status === k).length)}`).join(", ");
  const header = `${String(matches.length)} of ${String(all.length)} tracked subsessions match (${counts})${shown.length < matches.length ? `; showing ${String(shown.length)}` : ""}.`;
  if (matches.length === 0) return all.length === 0 ? "No tracked subsessions." : header;
  return `${header}\n${shown.map((s) => (filter.compact === true ? compactLine(s, now) : statusLine(s))).join("\n")}`;
}

function renderEntry(entry: TranscriptEntry): string {
  const header = `#${String(entry.index)} ${entry.role}`;
  const body = entry.parts.map(renderPart).filter((line) => line !== "").join("\n");
  return body === "" ? header : `${header}\n${body}`;
}

function clipNotice(part: TranscriptEntry["parts"][number]): string {
  if ((part.kind === "text" || part.kind === "thinking" || part.kind === "tool_result") && part.truncated !== undefined) {
    return ` [+${String(part.truncated.full - part.truncated.shown)} chars truncated]`;
  }
  return "";
}

function renderPart(part: TranscriptEntry["parts"][number]): string {
  if (part.kind === "text") return `${part.text}${clipNotice(part)}`;
  if (part.kind === "thinking") return `[thinking] ${part.text}${clipNotice(part)}`;
  if (part.kind === "tool_call") {
    // Raw args are only present when the caller asked (includeToolArgs); when
    // present, surface them in the model-facing text, not just `details`.
    const args = "args" in part && part.args !== undefined ? `\n  args: ${JSON.stringify(part.args)}` : "";
    return `[tool ${part.toolName}] ${part.summary}${args}`;
  }
  if (part.kind === "tool_result") return `[result${part.isError ? " error" : ""}${part.toolName === undefined ? "" : ` ${part.toolName}`}] ${part.text}${clipNotice(part)}`;
  return "[image]";
}

function renderTranscript(result: SubsessionReadResult): string {
  const last = result.entries[result.entries.length - 1];
  // Distinguish "nothing matched at all" (widen filters) from "matches exist but
  // this page/window is empty" (page differently) so the agent isn't misled.
  const range = last === undefined
    ? (result.matched === 0
      ? "no messages matched your filters"
      : `no messages in this window (${String(result.matched)} matched outside it)`)
    : `messages ${String(result.start)}–${String(last.index)} of ${String(result.total)} (${String(result.matched)} matched)`;
  const more = result.hasMore ? ` Earlier matching messages exist before index ${String(result.start)}.` : "";
  // Empty entries with matches means the `before` cursor excluded every match
  // (they all sit at index >= before): the agent paged too far back and should
  // raise `before` or omit it, not page back further.
  const body = result.entries.length > 0
    ? result.entries.map(renderEntry).join("\n\n")
    : (result.matched === 0
      ? "(no messages matched the filters)"
      : `(no messages before index ${String(result.start)}; all ${String(result.matched)} matches have later indexes)`);
  const error = result.errorDetail === undefined ? "" : `Error: ${result.errorDetail}\n\n`;
  return `Subsession ${subsessionDisplay(result.sessionId, result.name)} [${result.status}] — ${range}.${more}\n\n${error}--- SUBSESSION TRANSCRIPT: ${result.sessionId} ---\n${body}`;
}

/**
 * Tools that let an agent spawn *tracked* child sessions, inspect them, and
 * explicitly yield at a join point.
 *
 * A subsession records its parent in its session header, the parent is notified
 * when it stops working, and the parent may read its transcript/result. The
 * tools are constructed per-session, carrying the spawning cwd for
 * project-scope validation; the parent's
 * identity is taken from the live extension context at call time.
 */
export function createSubsessionToolDefinitions(spawningCwd: string, deps: SubsessionToolDeps) {
  const spawnTool = defineTool<typeof SpawnSubsessionParams, SpawnSubsessionResult>({
    name: "spawn_subsession",
    label: "Spawn subsession",
    description: "Start a new tracked child for part of the current task, then return its ID/cwd and resolved model/effort without waiting for its work to finish. Omitted model and thinkingLevel inherit this session's settings; Pi may clamp inherited/requested effort for the model. cwd must be an existing workspace of the same registered project. It selects a checkout but does NOT create a worktree, switch branches or isolate files from other workers. Reuse an existing child with send_subsession_message for follow-ups instead of spawning a replacement. Completion notices describe a finished turn, not proof its background jobs are done: detached jobs may wake it later, and waiting notices may be compact. Inspect with check_subsession; do not poll. Name is display metadata, not a unique identity.",
    promptSnippet: "spawn_subsession: new tracked child, not file isolation; returns before work finishes; reuse existing children for follow-ups",
    parameters: SpawnSubsessionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const thinkingLevel = params.thinkingLevel ?? ctx.thinkingLevel;
      const result = await deps.spawn({
        spawningCwd,
        parentSessionId,
        parentSessionFile,
        prompt: params.prompt,
        ...(params.cwd === undefined ? {} : { cwd: params.cwd }),
        ...(params.name === undefined ? {} : { name: params.name }),
        ...(ctx.model === undefined ? {} : { model: ctx.model }),
        ...(params.model === undefined ? {} : { modelSpec: params.model }),
        ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      });
      const modelNote = result.model === undefined ? "" : ` using model ${formatMetadataText(result.model)}`;
      const thinkingNote = result.thinkingLevel === undefined ? "" : ` at thinking level ${formatMetadataText(result.thinkingLevel)}`;
      return {
        content: [{ type: "text", text: `Started tracked subsession ${subsessionDisplay(result.sessionId, result.name)} in ${result.cwd}${modelNote}${thinkingNote}. Continue other work, or end your turn with a brief close-out message. Completion notices wake you; do not poll.` }],
        details: result,
      };
    },
  });

  const listTool = defineTool<typeof ListSubsessionsParams, { subsessions: SubsessionSummary[] }>({
    name: "list_subsessions",
    label: "List subsessions",
    description: "Snapshot of your direct tracked children, not all sessions or descendants. Default is a full rendered row for EVERY child; use compact:true and limit for a short list. Optional status/name filters and limit affect rendered text only; structured details retain all rows. Header counts are after filtering but before the limit. Context tokens/window are SDK estimates, distinct from cumulative session token totals. Unloaded children may have unknown status or missing/stored observations; missing values are not zero. idle/error describe agent state, not whether detached jobs remain: check_subsession queries those jobs. Quoted metadata is escaped and capped at 120 displayed characters; IDs remain the identity. Does not wait, resume work or acknowledge completion notices. Do not poll.",
    promptSnippet: "list_subsessions: inspect child statuses; never yields",
    parameters: ListSubsessionsParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const subsessions = await deps.list(parentSessionId, parentSessionFile);
      const text = renderSubsessionList(subsessions, params, Date.now());
      return { content: [{ type: "text", text }], details: { subsessions } };
    },
  });

  const checkTool = defineTool<typeof CheckSubsessionParams, SubsessionCheckResult | SubsessionReadResult>({
    name: "check_subsession",
    label: "Check subsession",
    description: "Inspect a verified direct child; may open an unloaded runtime but does not wait for the child to finish. SUMMARY (default): status, SDK-estimated context/current window, cumulative usage, latest available assistant text without a size cap, recent tool activity, and up to 4 system/custom/provider evidence excerpts. Text can predate a silent/failed turn: check status/errors before treating it as new work. Activity uses recorded message/event times, not a heartbeat. A running tool means no result was recorded, not OS liveness. 3+ identical calls trigger a warning, not proof of a stuck worker. WORKING: rendered text withholds assistant prose, full tool output and transcript even if you pass transcript filters. TRANSCRIPT: any roles/include/search/maxChars/includeToolArgs/before/limit value, even false or [], selects this mode; calls is then ignored. At most 50 newest matching messages are returned in chronological order. See parameter descriptions for clipping/search/paging rules; images are placeholders. Evidence labels separate persisted messages from live provider/retry events; the bounded live buffer is lost on runtime unload and is not part of transcript search. Quoted metadata, evidence excerpts and displayed job commands/paths are escaped and capped at 120 displayed characters. Both modes query live detached jobs; structured details retain full commands/paths. Logs hold full job output. No registry response means UNKNOWN, not no jobs. SIDE EFFECT: returning a matching latest completion's full assistant text acknowledges it and suppresses its pending notice. Returning an error-only completion also acknowledges it, even in a filtered transcript. Clipped/older/filtered text otherwise leaves the notice unread. A receipt-storage failure fails the tool and leaves the completion unread. Never waits for completion or sends an instruction; do not poll.",
    promptSnippet: "check_subsession: inspect a child (status/final output/live tool activity; filter args give its transcript); never yields",
    parameters: CheckSubsessionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const { sessionId, calls, ...query } = params;
      const transcriptMode = Object.values<unknown>(query).some((value) => value !== undefined);
      if (transcriptMode) {
        const result = await deps.read(parentSessionId, sessionId, { ...query, maxChars: query.maxChars ?? TRANSCRIPT_DEFAULT_MAX_CHARS }, parentSessionFile, _toolCallId);
        const text = result.status === "working"
          ? workingInspectionGuidance(result.sessionId, result.name, result.activity)
          : renderTranscript(result);
        return { content: [{ type: "text", text: `${text}\n\n${renderSubsessionBackgroundJobs(result.backgroundJobs, formatMetadataText)}` }], details: result };
      }
      const result = await deps.check(parentSessionId, sessionId, parentSessionFile, _toolCallId, calls);
      const body = result.finalText === "" ? "(no output yet)" : result.finalText;
      const observed = observationLine(result);
      const observedText = observed === "" ? "" : `${observed}\n\n`;
      const text = result.status === "working"
        ? `${workingInspectionGuidance(result.sessionId, result.name, result.activity)}\n\n${observedText}`.trimEnd()
        : `Subsession ${subsessionDisplay(result.sessionId, result.name)} [${result.status}].\n\n${observedText}${result.errorDetail === undefined ? "" : `Error: ${result.errorDetail}\n\n`}${result.activity === undefined ? "" : `${renderSubsessionActivity(result.activity, Date.now(), formatMetadataText)}\n\n`}--- SUBSESSION OUTPUT: ${result.sessionId} ---\n${body}`;
      return { content: [{ type: "text", text: `${text}\n\n${renderSubsessionBackgroundJobs(result.backgroundJobs, formatMetadataText)}` }], details: result };
    },
  });

  const sendTool = defineTool<typeof SendSubsessionMessageParams, { sessionId: string }>({
    name: "send_subsession_message",
    label: "Message subsession",
    description: "Send another instruction to your existing direct tracked child, preserving its history, model and effort. Reuse this for follow-ups. If working, the message steers it at the next agent boundary; it does NOT cancel a running tool, stop detached jobs or guarantee immediate interruption. If idle, it starts another turn. A successful return means the instruction was accepted, not that work finished or succeeded. It does not wait for a reply; continue other work or end your turn normally and await a completion notice. To interrupt rather than steer, use stop_subsession. Empty/whitespace messages are rejected.",
    promptSnippet: "send_subsession_message: continue an existing child's conversation by sessionId",
    parameters: SendSubsessionMessageParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await deps.send(ctx.sessionManager.getSessionId(), params.sessionId, params.message, ctx.sessionManager.getSessionFile() ?? undefined, "steer");
      return {
        content: [{ type: "text", text: `Steering message accepted for subsession ${params.sessionId}. Continue other work, or end your turn normally. Completion notices wake you; do not poll.` }],
        details: { sessionId: params.sessionId },
      };
    },
  });

  const stopTool = defineTool<typeof CheckSubsessionParams, { sessionId: string }>({
    name: "stop_subsession",
    label: "Stop subsession",
    description: "Interrupt only your direct tracked child's current agent run and clear its queued prompts. Preserves history/model/effort; this does not delete or permanently retire the child. Does NOT stop descendants, kill its detached Bash/monitor jobs, undo effects already performed, or erase previously delivered notices. check_subsession can inspect remaining jobs; background_stop must run in the session that owns a job. send_subsession_message resumes the stopped child. Only sessionId is used; inspection options exposed by the shared schema are ignored. The stop can fail; an error is not proof that every operation stopped.",
    parameters: CheckSubsessionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await deps.stop(ctx.sessionManager.getSessionId(), params.sessionId, ctx.sessionManager.getSessionFile() ?? undefined);
      return {
        content: [{ type: "text", text: `Subsession ${params.sessionId} stopped. History preserved; use send_subsession_message to resume it.` }],
        details: { sessionId: params.sessionId },
      };
    },
  });

  const updateTool = defineTool<typeof UpdateSubsessionParams, { sessionId: string; name?: string } & Partial<SubsessionObservation>>({
    name: "update_subsession",
    label: "Update subsession",
    description: "Change your direct tracked child's name, model and/or thinkingLevel; provide at least one. Conversation/history are preserved. Name-only works while the child is working. Model and effort changes require idle state when each step is checked; they never stop active work for you. A model-only change lets Pi clamp the existing effort to the new model. An explicit thinkingLevel must be supported by the resulting model or that step rejects it. NOT ATOMIC: validates name first, then applies model, then effort, then rename. There is NO rollback. If effort is invalid, the child becomes busy, or another later step fails, earlier successful changes remain and rename may not happen. The error may not enumerate those changes: inspect the child before retrying. Successful model/effort changes report the settings in effect; name-only changes report the name.",
    parameters: UpdateSubsessionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.name === undefined && params.model === undefined && params.thinkingLevel === undefined) throw new Error("Provide name, model, thinkingLevel, or a combination");
      const name = params.name === undefined ? undefined : requireInitialSessionName(params.name);
      const parentId = ctx.sessionManager.getSessionId();
      const parentFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const modelObservation = params.model === undefined ? undefined : await deps.setModel(parentId, params.sessionId, params.model, parentFile);
      const observation = params.thinkingLevel === undefined ? modelObservation : await deps.setThinkingLevel(parentId, params.sessionId, params.thinkingLevel, parentFile);
      if (name !== undefined) await deps.rename(parentId, params.sessionId, name, parentFile);
      const parts = [
        name === undefined ? undefined : `renamed to ${subsessionDisplay(params.sessionId, name)}`,
        observation === undefined ? undefined : observationLine(observation),
      ].filter((part): part is string => part !== undefined);
      return {
        content: [{ type: "text", text: `Updated subsession ${params.sessionId}: ${parts.join("; ")}.` }],
        details: { sessionId: params.sessionId, ...(name === undefined ? {} : { name }), ...(observation ?? {}) },
      };
    },
  });
  return [spawnTool, listTool, checkTool, sendTool, stopTool, updateTool];
}

/**
 * The child-side tool for messaging a verified parent. Offered only to tracked
 * children, independently of the delegation tools they are denied.
 */
export function createSendParentMessageToolDefinition(deps: Pick<SubsessionToolDeps, "sendParent">) {
  return defineTool<typeof SendParentMessageParams, { sent: boolean }>({
    name: "send_parent_message",
    label: "Message parent",
    description: "Send a progress update/question to your verified parent, selected automatically from this active tracked child's persisted links. Does not end your turn, wait for a reply, or cancel the parent's current tool. An idle parent is woken; a working parent receives steering at its next agent boundary. Success means delivery was scheduled, not that the parent read or answered it; a later delivery failure is reported as a session error. If the parent is compacting, wait until compaction finishes before retrying. Only an active tracked child can use this; blank messages are rejected. Continue working after it returns.",
    parameters: SendParentMessageParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await deps.sendParent(ctx.sessionManager.getSessionId(), params.message, ctx.sessionManager.getSessionFile() ?? undefined, "steer");
      return {
        content: [{ type: "text", text: "Message accepted for your parent. Your run continues; this does not wait for a reply." }],
        details: { sent: true },
      };
    },
  });
}

