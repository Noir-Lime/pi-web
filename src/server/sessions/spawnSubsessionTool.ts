import { Type } from "pi-web-typebox";
import { KNOWN_THINKING_LEVELS } from "../../shared/thinkingLevels.js";
import { defineTool, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TranscriptContentKind, TranscriptEntry, TranscriptRole, TranscriptView } from "./subsessionTranscript.js";
import type { SubsessionCompletion } from "./subsessionCompletionInbox.js";

/** Lifecycle phase of a tracked subsession as seen by its parent. */
export type SubsessionStatus = "working" | "idle" | "error" | "unknown";

/** Cumulative session token accounting, as in SessionStatus.tokens. Not context occupancy. */
export interface SubsessionTokens { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }

/** Current context occupancy, as in SessionStatus.contextUsage. Not cumulative usage. */
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
   * cwd of the session that invoked the tool. A tracked child always runs in
   * this workspace, so it is both the project-scope check input and the target.
   */
  spawningCwd: string;
  /** Session id of the parent; the spawned session is tracked against it. */
  parentSessionId: string;
  /** Session file of the parent, recorded in the child's `parentSession` header. */
  parentSessionFile: string | undefined;
  prompt: string;
  /** Optional explicit session name; validated with the ordinary session-naming rules. */
  name?: string;
  /**
   * Requested target workspace. The tool never sets it; other callers may, and
   * anything other than {@link spawningCwd} is refused rather than retargeted.
   */
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
  errorDetail?: string;
}

export interface SubsessionJoinResult {
  subsessions: SubsessionSummary[];
  completions: SubsessionCompletion[];
}

/** Exploratory transcript read: a filtered, paginated slice of the subsession's history. */
export interface SubsessionReadResult extends TranscriptView {
  sessionId: string;
  cwd: string;
  status: SubsessionStatus;
  name?: string;
  errorDetail?: string;
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
  sendParent(childSessionId: string, message: string, childSessionFile?: string, mode?: "queue" | "steer"): Promise<void>;
  stop(parentSessionId: string, sessionId: string, parentSessionFile?: string): Promise<void>;
  send(parentSessionId: string, sessionId: string, message: string, parentSessionFile?: string, mode?: "queue" | "steer"): Promise<void>;
  spawn(input: SpawnSubsessionInvocation): Promise<SpawnSubsessionResult>;
  list(parentSessionId: string, parentSessionFile?: string): Promise<SubsessionSummary[]>;
  join(parentSessionId: string, parentSessionFile?: string, toolCallId?: string): Promise<SubsessionJoinResult>;
  check(parentSessionId: string, sessionId: string, parentSessionFile?: string, toolCallId?: string): Promise<SubsessionCheckResult>;
  read(parentSessionId: string, sessionId: string, query: SubsessionReadQuery, parentSessionFile?: string, toolCallId?: string): Promise<SubsessionReadResult>;
}

const SpawnSubsessionParams = Type.Object({
  name: Type.Optional(Type.String({
    description: "Optional name for the child session, shown as a quoted name followed by (id) in spawn/list/check/read results and completion notices. Must be trimmed, non-empty, at most 60 characters, and contain no control characters (the ordinary session-naming rules). Duplicate names are allowed; the id remains the identity.",
  })),
  thinkingLevel: Type.Optional(Type.Enum(KNOWN_THINKING_LEVELS, {
    description: "Thinking level override for the child session. Set this field only when instructed to use a specific thinking level or to choose an appropriate one. Otherwise omit it to inherit this session's thinking level. An unknown value is rejected; valid levels are clamped to the selected model's capabilities.",
  })),
  prompt: Type.String({
    description: "Initial instruction for the tracked child.",
  }),
  model: Type.Optional(Type.String({
    description: 'Model override for the child session, as an exact "provider/model-id". Set this field only when instructed to use a specific model or to choose an appropriate one. Otherwise omit it to inherit this session\'s model. An unknown value is rejected.',
  })),
});

const ListSubsessionsParams = Type.Object({});
const SendParentMessageParams = Type.Object({
  message: Type.String({ minLength: 1, description: "Progress update, question, or finding for your parent session." }),
});
const SendSubsessionMessageParams = Type.Object({
  sessionId: Type.String({ description: "Tracked child id from spawn_subsession or list_subsessions." }),
  message: Type.String({ minLength: 1, description: "Follow-up instruction or question for the existing child conversation." }),
});

const CheckSubsessionParams = Type.Object({
  sessionId: Type.String({
    description: "Tracked child id from spawn_subsession or list_subsessions.",
  }),
});

const ReadSubsessionParams = Type.Object({
  sessionId: Type.String({
    description: "Tracked child id from spawn_subsession or list_subsessions.",
  }),
  roles: Type.Optional(Type.Array(
    Type.Union([Type.Literal("assistant"), Type.Literal("user"), Type.Literal("tool"), Type.Literal("system"), Type.Literal("custom")]),
    { description: "Roles to include; omit for all." },
  )),
  include: Type.Optional(Type.Array(
    Type.Union([Type.Literal("text"), Type.Literal("thinking"), Type.Literal("tool_call"), Type.Literal("tool_result"), Type.Literal("image")]),
    { description: "Content kinds to include; omit for all." },
  )),
  search: Type.Optional(Type.String({
    description: "Case-insensitive text or tool-name substring; searches full content before maxChars truncation.",
  })),
  maxChars: Type.Optional(Type.Integer({
    minimum: 0,
    description: "Maximum characters per text, thinking, or tool-result value; omit for no truncation.",
  })),
  includeToolArgs: Type.Optional(Type.Boolean({
    description: "Include raw tool-call arguments; summaries are always included.",
  })),
  before: Type.Optional(Type.Integer({
    minimum: 0,
    description: "Return messages before this index; use the previous start to page backward.",
  })),
  limit: Type.Optional(Type.Integer({
    minimum: 1,
    description: "Maximum recent matches, in chronological order. Defaults to 50.",
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
    const c = observation.contextUsage;
    const percent = c.percent === null ? "unknown percent" : `${String(c.percent)}%`;
    const tokens = c.tokens === null ? "unknown tokens" : `${String(c.tokens)} tokens`;
    parts.push(`context usage ${percent} (${tokens} of ${String(c.contextWindow)} context window)`);
  }
  if (observation.observedAt !== undefined) parts.push(`observed at ${observation.observedAt}`);
  return parts.join("; ");
}

function statusLine(summary: SubsessionSummary): string {
  const observed = observationLine(summary);
  return `- ${subsessionDisplay(summary.sessionId, summary.name)} [${summary.status}] in ${summary.cwd}${observed === "" ? "" : ` — ${observed}`}`;
}

function workingInspectionGuidance(sessionId: string, name?: string): string {
  return `Subsession ${subsessionDisplay(sessionId, name)} is working; partial output is withheld. Continue other work, or end your turn with a brief close-out message. Completion notices wake you; do not poll.`;
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
 * tools are constructed per-session, carrying the spawning cwd, which is both
 * the project-scope validation input and the child's workspace; the parent's
 * identity is taken from the live extension context at call time.
 */
export function createSubsessionToolDefinitions(spawningCwd: string, deps: SubsessionToolDeps) {
  const spawnTool = defineTool<typeof SpawnSubsessionParams, SpawnSubsessionResult>({
    name: "spawn_subsession",
    label: "Spawn subsession",
    description: "Start a tracked child session in this session's working directory to carry out part of the current task and return immediately. Its transcript and result are available here after it finishes.",
    promptSnippet: "spawn_subsession: tracked child work in this workspace; result available after completion",
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
    description: "List tracked child statuses. Never yields or changes control flow; do not poll.",
    promptSnippet: "list_subsessions: inspect child statuses; never yields",
    parameters: ListSubsessionsParams,
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const subsessions = await deps.list(parentSessionId, parentSessionFile);
      const text = subsessions.length === 0
        ? "No tracked subsessions."
        : `Tracked subsessions:\n${subsessions.map(statusLine).join("\n")}`;
      return { content: [{ type: "text", text }], details: { subsessions } };
    },
  });

  const checkTool = defineTool<typeof CheckSubsessionParams, SubsessionCheckResult>({
    name: "check_subsession",
    label: "Check subsession",
    description: "Get a tracked child's status and latest output. Receiving a completed result marks it read, so it will not arrive again automatically. Working output is withheld. Never yields; do not poll.",
    promptSnippet: "check_subsession: inspect child status and available output; never yields",
    parameters: CheckSubsessionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const result = await deps.check(parentSessionId, params.sessionId, parentSessionFile, _toolCallId);
      const body = result.finalText === "" ? "(no output yet)" : result.finalText;
      const observed = observationLine(result);
      const observedText = observed === "" ? "" : `${observed}\n\n`;
      const text = result.status === "working"
        ? `${workingInspectionGuidance(result.sessionId, result.name)}\n\n${observedText}`.trimEnd()
        : `Subsession ${subsessionDisplay(result.sessionId, result.name)} [${result.status}].\n\n${observedText}${result.errorDetail === undefined ? "" : `Error: ${result.errorDetail}\n\n`}--- SUBSESSION OUTPUT: ${result.sessionId} ---\n${body}`;
      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  });

  const readTool = defineTool<typeof ReadSubsessionParams, SubsessionReadResult>({
    name: "read_subsession",
    label: "Read subsession",
    description: "Read a tracked child's filtered transcript. Returning its complete latest final output marks that completion read; filtered or historical-only reads do not. Working transcripts are withheld. Never yields; do not poll.",
    promptSnippet: "read_subsession: inspect an available child transcript; never yields",
    parameters: ReadSubsessionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
      const { sessionId, ...query } = params;
      const result = await deps.read(parentSessionId, sessionId, query, parentSessionFile, _toolCallId);
      const text = result.status === "working"
        ? workingInspectionGuidance(result.sessionId, result.name)
        : renderTranscript(result);
      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  });

  const sendTool = defineTool<typeof SendSubsessionMessageParams, { sessionId: string }>({
    name: "send_subsession_message",
    label: "Message subsession",
    description: "Send a steering message to an existing tracked child, preserving its conversation and model. Redirects active work at the next steering boundary without forcibly cancelling running tools; resumes an idle child. Completion notices wake you again; end your turn normally when waiting.",
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
    description: "Interrupt a tracked child's current work and clear its queued prompts. Preserves its history and model so send_subsession_message can resume it later. Only stops your own direct child, not its descendants. Does not undo completed tool actions.",
    parameters: CheckSubsessionParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await deps.stop(ctx.sessionManager.getSessionId(), params.sessionId, ctx.sessionManager.getSessionFile() ?? undefined);
      return {
        content: [{ type: "text", text: `Subsession ${params.sessionId} stopped. History preserved; use send_subsession_message to resume it.` }],
        details: { sessionId: params.sessionId },
      };
    },
  });

  return [spawnTool, listTool, checkTool, readTool, sendTool, stopTool];
}

/**
 * The child-side tool for messaging a verified parent. Offered only to tracked
 * children, independently of the delegation tools they are denied.
 */
export function createSendParentMessageToolDefinition(deps: Pick<SubsessionToolDeps, "sendParent">) {
  return defineTool<typeof SendParentMessageParams, { sent: boolean }>({
    name: "send_parent_message",
    label: "Message parent",
    description: "Send a steering message to your verified parent without ending your run or waiting for a reply. The parent is selected automatically and woken if idle; active work is redirected at the next steering boundary. Only usable by tracked children. Continue working after this tool returns.",
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

