import { describe, expect, it } from "vitest";
import { buildSubsessionActivity, renderSubsessionActivity, subsessionRuntimeEvidence } from "./subsessionActivity.js";
import { renderSubsessionList, type SubsessionSummary } from "./spawnSubsessionTool.js";

const call = (id: string, name: string, args: unknown, timestamp = 1000) => ({ role: "assistant", timestamp, content: [{ type: "toolCall", id, name, arguments: args }] });
const result = (id: string, isError = false, timestamp = 1001) => ({ role: "toolResult", toolCallId: id, isError, timestamp, content: "SECRET OUTPUT" });

describe("buildSubsessionActivity", () => {
  it("marks calls running until their result arrives and tracks the newest timestamp", () => {
    const a = buildSubsessionActivity([call("1", "bash", { command: "ls" }, 10), result("1", false, 11), call("2", "read", { path: "/x" }, 20), call("3", "bash", { command: "boom" }, 30), result("3", true, 31)]);
    expect(a.calls.map((c) => [c.toolName, c.state])).toEqual([["bash", "done"], ["read", "running"], ["bash", "error"]]);
    expect(a.running).toBe(1);
    expect(a.totalCalls).toBe(3);
    expect(a.lastActivityAt).toBe(31);
  });

  it("limits to the most recent calls and never exposes output or prose", () => {
    const messages = Array.from({ length: 12 }, (_, i) => [call(`c${String(i)}`, "bash", { command: `cmd${String(i)}` }), result(`c${String(i)}`)]).flat();
    const a = buildSubsessionActivity(messages, 3);
    expect(a.calls.map((c) => c.summary)).toEqual(["cmd9", "cmd10", "cmd11"]);
    expect(JSON.stringify(a)).not.toContain("SECRET OUTPUT");
  });

  it("shows bounded persisted system/custom/provider evidence, not assistant prose or tool output", () => {
    const activity = buildSubsessionActivity([
      { role: "system", content: "prompt patch", timestamp: 1 },
      { role: "custom", customType: "background.bash", content: [{ type: "text", text: "bg-1 complete: exit 0" }], timestamp: 2 },
      { role: "assistant", errorMessage: "429 overloaded", content: [{ type: "text", text: "PRIVATE PROSE" }], timestamp: 3 },
      result("unknown"),
      { role: "custom", customType: "job", content: "x".repeat(300), timestamp: 4 },
      { role: "system", content: "latest", timestamp: 5 },
    ]);
    expect(activity.messages).toHaveLength(4);
    expect(activity.messages?.[0]).toMatchObject({ source: "persisted", kind: "background.bash", summary: "bg-1 complete: exit 0" });
    expect(activity.messages?.[1]?.summary).toBe("429 overloaded");
    expect(activity.messages?.[2]?.summary).toHaveLength(240);
    const text = renderSubsessionActivity(activity, 100, JSON.stringify);
    expect(text).toContain("[persisted]");
    expect(text).not.toContain("PRIVATE PROSE");
    expect(text).not.toContain("SECRET OUTPUT");
  });

  it("retains actual live retry fields separately from durable messages and deduplicates persisted errors", () => {
    const event = subsessionRuntimeEvidence({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "HTTP 429 overloaded" }, 30);
    const ended = subsessionRuntimeEvidence({ type: "auto_retry_end", success: false, attempt: 3, finalError: "still overloaded" }, 40);
    const error = { role: "assistant", errorMessage: "HTTP 429 overloaded", content: [], timestamp: 20 };
    const failed = subsessionRuntimeEvidence({ type: "message_end", message: error }, 21);
    expect(event).toEqual({ source: "live", kind: "auto_retry_start", summary: "attempt 1/3; delayMs 2000; HTTP 429 overloaded", at: 30 });
    expect(ended?.summary).toBe("attempt 3; success false; still overloaded");
    if (event === undefined || failed === undefined || ended === undefined) throw new Error("missing evidence");
    const activity = buildSubsessionActivity([error], 1, [failed, event, ended]);
    expect(activity.messages).toHaveLength(3);
    expect(activity.messages?.[0]?.source).toBe("persisted");
    expect(activity.lastActivityAt).toBe(40);
    expect(subsessionRuntimeEvidence({ type: "message_update", message: error }, 30)).toBeUndefined();
  });

  it("flags a trailing run of identical calls regardless of key order, not a varied run", () => {
    const same = [1, 2, 3, 4].map((i) => call(`s${String(i)}`, "bash", i % 2 === 0 ? { command: "git status", cwd: "/a" } : { cwd: "/a", command: "git status" }));
    expect(buildSubsessionActivity(same).repeat).toEqual({ toolName: "bash", summary: "git status", count: 4 });
    const varied = [call("a", "bash", { command: "a" }), call("b", "bash", { command: "b" }), call("c", "bash", { command: "a" })];
    expect(buildSubsessionActivity(varied).repeat).toBeUndefined();
    expect(buildSubsessionActivity([call("a", "bash", { command: "x" }), call("b", "bash", { command: "x" })]).repeat).toBeUndefined();
  });

  it("renders gap, repeat warning and calls through the supplied escaper", () => {
    const a = buildSubsessionActivity([1, 2, 3].map((i) => call(String(i), "bash", { command: "git status" }, 1000)));
    const text = renderSubsessionActivity(a, 1000 + 125_000, (v) => `<${v}>`);
    expect(text).toContain("2m ago");
    expect(text).toContain("REPEAT: the last 3 calls are identical: <bash> <git status>");
    expect(text).toContain("[running] <bash> <git status>");
  });
});

describe("renderSubsessionList", () => {
  const rows: SubsessionSummary[] = [
    { sessionId: "i1", cwd: "/a", status: "idle", name: "ALPHA" },
    { sessionId: "w1", cwd: "/a", status: "working", name: "BETA", contextUsage: { tokens: 1, contextWindow: 2, percent: 41.6 }, lastActivityAt: new Date(1000).toISOString() },
    { sessionId: "u1", cwd: "", status: "unknown" },
  ];

  it("filters by status and name, puts working first, and reports the full count", () => {
    expect(renderSubsessionList(rows, { status: ["working"] }, 1000)).toMatch(/^1 of 3 tracked subsessions match \(working 1, idle 0, error 0, unknown 0\)/);
    expect(renderSubsessionList(rows, { name: "alp" }, 1000)).toContain("ALPHA");
    expect(renderSubsessionList(rows, {}, 1000).split("\n")[1]).toContain("BETA");
  });

  it("compact output shows raw context tokens/window, not unreliable percent; limit is reported", () => {
    const text = renderSubsessionList(rows, { compact: true, limit: 1 }, 31_000);
    expect(text).toContain("showing 1");
    expect(text).toContain('- "BETA" (w1) [working] context 1 of 2 tokens (SDK estimate) active 30s ago');
    expect(text).not.toContain("/a");
  });
});
