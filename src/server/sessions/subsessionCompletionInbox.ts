import { requireInitialSessionName } from "./sessionNameGenerator.js";
import { subsessionDisplay, type SubsessionContextUsage, type SubsessionStatus, type SubsessionTokens } from "./spawnSubsessionTool.js";

export const SUBSESSION_COMPLETION_ENTRY_TYPE = "pi-web.subsession.completed";
export const SUBSESSION_RECEIPT_ENTRY_TYPE = "pi-web.subsession.received";
export const SUBSESSION_NOTIFICATION_CUSTOM_TYPE = "subsession.completion";

/** Immutable result of one child run, not the child's mutable current status. */
export interface SubsessionCompletion {
  completionId: string;
  sessionId: string;
  cwd: string;
  status: Exclude<SubsessionStatus, "working" | "unknown">;
  finalText: string;
  messageCount: number;
  errorDetail?: string;
  startedAt?: string;
  completedAt?: string;
  /** Child name snapshot at completion; absent in records written before names existed. */
  name?: string;
  /** Configured/resolved model snapshot at completion, as `provider/id`. */
  model?: string;
  thinkingLevel?: string;
  /** Cumulative session usage snapshot at completion. */
  tokens?: SubsessionTokens;
  /** Context occupancy snapshot at completion. */
  contextUsage?: SubsessionContextUsage;
}

/** One owner for delivery through tools, run boundaries, and idle-parent wakes. */
export class SubsessionCompletionInbox {
  private readonly completions = new Map<string, SubsessionCompletion>();
  private readonly received = new Set<string>();
  private readonly claimed = new Set<string>();

  record(completion: SubsessionCompletion): void {
    this.completions.set(completion.completionId, completion);
  }

  latest(sessionId: string): SubsessionCompletion | undefined {
    let latest: SubsessionCompletion | undefined;
    for (const completion of this.completions.values()) {
      if (completion.sessionId === sessionId) latest = completion;
    }
    return latest;
  }

  pending(): SubsessionCompletion[] {
    return [...this.completions.values()].filter(({ completionId }) => !this.received.has(completionId) && !this.claimed.has(completionId));
  }

  claim(): SubsessionCompletion[] {
    const pending = this.pending();
    for (const { completionId } of pending) this.claimed.add(completionId);
    return pending;
  }

  receive(completionIds: readonly string[]): void {
    for (const id of completionIds) {
      this.received.add(id);
      this.claimed.delete(id);
    }
  }

  hasReceived(completionId: string): boolean {
    return this.received.has(completionId);
  }

  release(completionIds: readonly string[]): void {
    for (const id of completionIds) this.claimed.delete(id);
  }

  releaseClaims(): void {
    this.claimed.clear();
  }

  forgetChild(sessionId: string): void {
    for (const [id, completion] of this.completions) {
      if (completion.sessionId !== sessionId) continue;
      this.completions.delete(id);
      this.received.delete(id);
      this.claimed.delete(id);
    }
  }

  /** Receipts follow the active parent branch; rewinding before a receipt restores unread results. */
  restoreReceipts(entries: readonly unknown[], releaseClaims = true): void {
    this.received.clear();
    if (releaseClaims) this.claimed.clear();
    const toolResults = new Map<string, number>();
    for (const [index, entry] of entries.entries()) {
      if (!isRecord(entry) || entry["type"] !== "message" || !isRecord(entry["message"])) continue;
      const message = entry["message"];
      if (message["role"] === "toolResult" && message["isError"] !== true && typeof message["toolCallId"] === "string") {
        toolResults.set(message["toolCallId"], index);
        const nested = message["nestedCalls"];
        if (isRecord(nested) && Array.isArray(nested["calls"])) {
          for (const call of nested["calls"]) {
            if (isRecord(call) && call["status"] === "ok" && typeof call["id"] === "string") toolResults.set(call["id"], index);
          }
        }
      }
    }
    for (const [index, entry] of entries.entries()) {
      if (!isRecord(entry)) continue;
      if (entry["type"] === "custom" && entry["customType"] === SUBSESSION_RECEIPT_ENTRY_TYPE) {
        const data = entry["data"];
        // A tool receipt only counts after its successful result was committed.
        // A crash, failed result write, or rewind between them must not lose an answer.
        if (isRecord(data) && typeof data["toolCallId"] === "string" && (toolResults.get(data["toolCallId"]) ?? -1) <= index) continue;
        this.receive(completionReceiptIds(data));
      } else if (entry["type"] === "custom_message" && entry["customType"] === SUBSESSION_NOTIFICATION_CUSTOM_TYPE) {
        this.receive(completionReceiptIds(entry["details"]));
      }
    }
  }
}

export function completionReceiptIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value["completionIds"])) return [];
  return value["completionIds"].filter((id): id is string => typeof id === "string");
}

export function persistedSubsessionCompletions(entries: readonly unknown[]): SubsessionCompletion[] {
  return entries.flatMap((entry) => {
    if (!isRecord(entry) || entry["type"] !== "custom" || entry["customType"] !== SUBSESSION_COMPLETION_ENTRY_TYPE) return [];
    const data = entry["data"];
    if (!isRecord(data) || typeof data["completionId"] !== "string" || typeof data["sessionId"] !== "string"
      || typeof data["cwd"] !== "string" || (data["status"] !== "idle" && data["status"] !== "error")
      || typeof data["finalText"] !== "string" || typeof data["messageCount"] !== "number"
      || !Number.isSafeInteger(data["messageCount"]) || data["messageCount"] < 0) return [];
    const name = persistedName(data["name"]);
    const tokens = persistedTokens(data["tokens"]);
    const contextUsage = persistedContextUsage(data["contextUsage"]);
    return [{
      completionId: data["completionId"], sessionId: data["sessionId"], cwd: data["cwd"], status: data["status"],
      finalText: data["finalText"], messageCount: data["messageCount"],
      ...(typeof data["startedAt"] === "string" ? { startedAt: data["startedAt"] } : {}),
      ...(typeof data["completedAt"] === "string" ? { completedAt: data["completedAt"] } : {}),
      ...(typeof data["errorDetail"] === "string" ? { errorDetail: data["errorDetail"] } : {}),
      ...(name === undefined ? {} : { name }),
      ...(typeof data["model"] === "string" && data["model"] !== "" ? { model: data["model"] } : {}),
      ...(typeof data["thinkingLevel"] === "string" && data["thinkingLevel"] !== "" ? { thinkingLevel: data["thinkingLevel"] } : {}),
      ...(tokens === undefined ? {} : { tokens }),
      ...(contextUsage === undefined ? {} : { contextUsage }),
    }];
  });
}

/** Bound automatic notices; deliberate inspection still returns the complete run output. */
/** A persisted name is display text: accept only the ordinary naming shape, so a crafted record cannot inject lines into a notice. */
function persistedName(value: unknown): string | undefined {
  try { return requireInitialSessionName(value); } catch { return undefined; }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function persistedTokens(value: unknown): SubsessionTokens | undefined {
  if (!isRecord(value)) return undefined;
  const { input, output, cacheRead, cacheWrite, total } = value;
  if (!isFiniteNumber(input) || !isFiniteNumber(output) || !isFiniteNumber(cacheRead) || !isFiniteNumber(cacheWrite) || !isFiniteNumber(total)) return undefined;
  return { input, output, cacheRead, cacheWrite, total };
}

function persistedContextUsage(value: unknown): SubsessionContextUsage | undefined {
  if (!isRecord(value)) return undefined;
  const contextWindow = value["contextWindow"];
  const tokens = value["tokens"];
  const percent = value["percent"];
  if (!isFiniteNumber(contextWindow)) return undefined;
  if (tokens !== null && !isFiniteNumber(tokens)) return undefined;
  if (percent !== null && !isFiniteNumber(percent)) return undefined;
  return { tokens, contextWindow, percent };
}

export function renderSubsessionCompletion(completion: SubsessionCompletion): string {
  const { sessionId, status, finalText, errorDetail, startedAt, completedAt } = completion;
  const error = errorDetail === undefined ? "" : `Error: ${errorDetail}\n\n`;
  const snapshotParts: string[] = [];
  if (completion.model !== undefined) snapshotParts.push(`model ${completion.model}`);
  if (completion.thinkingLevel !== undefined) snapshotParts.push(`thinking level ${completion.thinkingLevel}`);
  if (completion.tokens !== undefined) snapshotParts.push(`cumulative tokens ${String(completion.tokens.total)} total`);
  if (completion.contextUsage !== undefined) {
    const percent = completion.contextUsage.percent === null ? "unknown percent" : `${String(completion.contextUsage.percent)}%`;
    snapshotParts.push(`context usage ${percent} of ${String(completion.contextUsage.contextWindow)} context window`);
  }
  const snapshot = snapshotParts.length === 0 ? "" : `Run snapshot: ${snapshotParts.join("; ")}.\n\n`;
  const output = finalText.length > 2000
    ? `--- SUBSESSION OUTPUT EXCERPT (this run): ${sessionId} ---\n${finalText.slice(0, 600)}\n[… ${String(finalText.length - 1800)} characters omitted …]\n${finalText.slice(-1200)}\n--- END EXCERPT ---\nCall check_subsession with sessionId "${sessionId}" to retrieve the full final output.`
    : `--- SUBSESSION OUTPUT (this run): ${sessionId} ---\n${finalText === "" ? "(no assistant text in this run)" : finalText}`;
  const run = startedAt === undefined ? "" : ` The run started ${startedAt}${completedAt === undefined ? "" : ` and ended ${completedAt}`}.`;
  return `Subsession ${subsessionDisplay(sessionId, completion.name)} stopped working (${status} at completion, not necessarily now).${run}\n\n${snapshot}${error}${output}`;
}

export function renderSubsessionCompletions(completions: readonly SubsessionCompletion[], workingIds: readonly string[]): string {
  const next = workingIds.length === 0
    ? "No other tracked subsessions are working."
    : `Still working: ${workingIds.join(", ")}. Continue working, or end your turn with a brief close-out message. Further unread results arrive automatically; do not poll.`;
  return `${completions.map(renderSubsessionCompletion).join("\n\n")}\n\n${next}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
