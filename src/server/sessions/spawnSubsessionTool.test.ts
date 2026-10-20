import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { Check } from "pi-web-typebox/value";
import { KNOWN_THINKING_LEVELS } from "../../shared/thinkingLevels.js";
import { stubExtensionToolContext } from "./piSessionService.testSupport.js";
import { createSubsessionToolDefinitions, formatMetadataText, subsessionDisplay, type SubsessionToolDeps } from "./spawnSubsessionTool.js";

const dispatchModel = { provider: "anthropic", id: "claude-sonnet" };

function ctxFor(sessionId: string, sessionFile: string | undefined, model?: unknown, thinkingLevel?: string): ExtensionToolContext {
  // The subsession tools only read sessionManager.getSessionId/getSessionFile, model, and thinkingLevel.
  return stubExtensionToolContext({
    sessionManager: { getSessionId: () => sessionId, getSessionFile: () => sessionFile },
    model,
    thinkingLevel,
  });
}

function tools(deps: Partial<SubsessionToolDeps>) {
  const list = deps.list ?? vi.fn(() => Promise.resolve([]));
  const full: SubsessionToolDeps = {
    rename: deps.rename ?? vi.fn(() => Promise.resolve()),
    setModel: deps.setModel ?? vi.fn(() => Promise.resolve({ model: "test/model" })),
    send: deps.send ?? vi.fn(() => Promise.resolve()),
    sendParent: deps.sendParent ?? vi.fn(() => Promise.resolve()),
    stop: deps.stop ?? vi.fn(() => Promise.resolve()),
    spawn: deps.spawn ?? vi.fn(() => Promise.resolve({ sessionId: "x", cwd: "/repos/a" })),
    list,
    join: deps.join ?? (async (parentId, parentFile) => ({ subsessions: await list(parentId, parentFile), completions: [] })),
    check: deps.check ?? vi.fn(() => Promise.resolve({ sessionId: "x", cwd: "/repos/a", status: "idle" as const, finalText: "", messageCount: 0 })),
    read: deps.read ?? vi.fn(() => Promise.resolve({ sessionId: "x", cwd: "/repos/a", status: "idle" as const, entries: [], total: 0, matched: 0, start: 0, hasMore: false })),
  };
  const definitions = createSubsessionToolDefinitions("/repos/a", full);
  const find = (name: string) => {
    const tool = definitions.find((definition) => definition.name === name);
    if (tool === undefined) throw new Error(`missing tool ${name}`);
    return tool;
  };
  return {
    spawn: find("spawn_subsession"),
    list: find("list_subsessions"),
    check: find("check_subsession"),
    read: find("check_subsession"),
    definitions,
  };
}

describe("formatMetadataText", () => {
  it("quotes metadata and escapes newlines, ANSI controls, and Unicode separators", () => {
    const rendered = formatMetadataText("Worker\nRun snapshot: model forged\u001b[31m\u2028next\u0085end");
    expect(rendered).toBe('"Worker\\u000aRun snapshot: model forged\\u001b[31m\\u2028next\\u0085end"');
    expect(rendered).not.toContain("\n");
    expect(rendered).not.toContain("\u2028");
  });

  it("visibly escapes Unicode Cf, Zl, and Zp code points, including supplementary tag characters", () => {
    expect(formatMetadataText("Worker\u202etrusted")).toBe('"Worker\\u202etrusted"'); // RLO
    expect(formatMetadataText("a\u2066b")).toBe('"a\\u2066b"'); // LRI
    expect(formatMetadataText("a\u200eb")).toBe('"a\\u200eb"'); // LRM
    expect(formatMetadataText("a\u200bb\ufeffc")).toBe('"a\\u200bb\\ufeffc"'); // ZWSP, BOM/ZWNBSP
    expect(formatMetadataText("tag\u{e0041}end")).toBe('"tag\\u{e0041}end"'); // supplementary Cf tag char
    expect(formatMetadataText("soft\u00adhyphen")).toBe('"soft\\u00adhyphen"'); // soft hyphen (Cf)
  });

  it("preserves plain accents, CJK, and emoji unchanged", () => {
    expect(formatMetadataText("café 北京 ☕ 🎉")).toBe('"café 北京 ☕ 🎉"');
  });

  it("never truncates inside an escape sequence", () => {
    // 117 x's + newline escape (6 chars) would cross the 119-char prefix cap
    // mid-escape; the whole escape is omitted instead.
    const rendered = formatMetadataText(`${"x".repeat(117)}\nmore text here`);
    expect(rendered).toBe(`"${"x".repeat(117)}…"`);
    expect(rendered).not.toContain("\\u");
  });

  it("stops before an escape that would be split at the truncation boundary", () => {
    // The 6-character RLO escape starts after 116 plain characters; a naive
    // 119-code-point cut would include a partial \\u202 sequence.
    const rendered = formatMetadataText(`${"x".repeat(116)}\u202e${"y".repeat(20)}`);
    expect(rendered).toBe(`"${"x".repeat(116)}…"`);
    expect(rendered).not.toContain("\\u202");
    expect(rendered.length).toBe(119);
  });

  it("bounds very long values with an ellipsis marker and preserves ordinary Unicode and Markdown as quoted data", () => {
    const rendered = formatMetadataText("x".repeat(300));
    expect(rendered.length).toBe(122);
    expect(rendered.endsWith('…"')).toBe(true);
    expect(formatMetadataText("café ☕ **bold** [link](https://example.invalid)")).toBe('"café ☕ **bold** [link](https://example.invalid)"');
    expect(subsessionDisplay("child-1", "**bold**")).toBe('"**bold**" (child-1)');
    expect(subsessionDisplay("child-1")).toBe("child-1");
  });
});

function workingGuidance(sessionId: string): string {
  return `Subsession ${sessionId} is working; partial output is withheld. Continue other work, or end your turn with a brief close-out message. Completion notices wake you; do not poll.`;
}

function firstText(content: readonly (TextContent | ImageContent)[]): string {
  const first = content[0];
  return first?.type === "text" ? first.text : "";
}

describe("createSubsessionToolDefinitions", () => {
  it("omits yield tools and guidance while retaining ordinary turn-end wakes", () => {
    const { definitions } = tools({});
    expect(definitions.map(({ name }) => name)).not.toContain("yield_to_subsessions");
    expect(JSON.stringify(definitions)).not.toContain("yield_to_subsessions");
    expect(definitions.map(({ name }) => name)).toEqual(["spawn_subsession", "list_subsessions", "check_subsession", "send_subsession_message", "stop_subsession", "rename_subsession", "set_subsession_model"]);
  });
  it("spawn_subsession forwards parent identity and params from the live context", async () => {
    const spawn = vi.fn(() => Promise.resolve({ sessionId: "child-1", cwd: "/repos/a" }));
    const { spawn: spawnTool } = tools({ spawn });

    const result = await spawnTool.execute("call-1", { prompt: "do it" }, undefined, undefined, ctxFor("parent-1", "/sessions/parent-1.jsonl", dispatchModel, "max"));

    expect(spawn).toHaveBeenCalledWith({
      spawningCwd: "/repos/a",
      parentSessionId: "parent-1",
      parentSessionFile: "/sessions/parent-1.jsonl",
      prompt: "do it",
      model: dispatchModel,
      thinkingLevel: "max",
    });
    expect(result.details).toEqual({ sessionId: "child-1", cwd: "/repos/a" });
    expect(firstText(result.content)).toContain("Started tracked subsession child-1");
  });

  it("spawn_subsession forwards an explicit name and renders name, model, and thinking level", async () => {
    const spawn = vi.fn(() => Promise.resolve({ sessionId: "child-1", cwd: "/repos/a", name: "Worker Bee", model: "openai/gpt-5", thinkingLevel: "high" }));
    const { spawn: spawnTool } = tools({ spawn });
    expect(Check(spawnTool.parameters, { prompt: "do it", name: "Worker Bee" })).toBe(true);
    const result = await spawnTool.execute("call-name", { prompt: "do it", name: "Worker Bee" }, undefined, undefined, ctxFor("parent-1", "/sessions/parent-1.jsonl", dispatchModel));
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ name: "Worker Bee" }));
    expect(result.details).toEqual({ sessionId: "child-1", cwd: "/repos/a", name: "Worker Bee", model: "openai/gpt-5", thinkingLevel: "high" });
    expect(firstText(result.content)).toContain('Started tracked subsession "Worker Bee" (child-1) in /repos/a using model "openai/gpt-5" at thinking level "high".');
  });

  it("spawn_subsession accepts and forwards an optional same-project workspace", async () => {
    const spawn = vi.fn(() => Promise.resolve({ sessionId: "child-1", cwd: "/repos/a-feature" }));
    const { spawn: spawnTool } = tools({ spawn });
    expect(Check(spawnTool.parameters, { prompt: "go", cwd: "/repos/a-feature" })).toBe(true);
    expect(Check(spawnTool.parameters, { prompt: "go", cwd: 1 })).toBe(false);
    await spawnTool.execute("cwd", { prompt: "go", cwd: "/repos/a-feature" }, undefined, undefined, ctxFor("parent-1", "/sessions/parent.jsonl"));
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ spawningCwd: "/repos/a", cwd: "/repos/a-feature" }));
  });

  it("forwards child controls with live parent ownership and renders the actual model", async () => {
    const rename = vi.fn(() => Promise.resolve());
    const setModel = vi.fn(() => Promise.resolve({ model: "test/new", thinkingLevel: "low" }));
    const { definitions } = tools({ rename, setModel });
    const renameTool = definitions.find(({ name }) => name === "rename_subsession");
    const modelTool = definitions.find(({ name }) => name === "set_subsession_model");
    if (renameTool === undefined || modelTool === undefined) throw new Error("missing child controls");
    expect(Check(renameTool.parameters, { sessionId: "child", name: "New name" })).toBe(true);
    expect(Check(modelTool.parameters, { sessionId: "child" })).toBe(false);
    const ctx = ctxFor("parent-1", "/sessions/parent.jsonl");
    await renameTool.execute("rename", { sessionId: "child", name: "New name" }, undefined, undefined, ctx);
    expect(rename).toHaveBeenCalledWith("parent-1", "child", "New name", "/sessions/parent.jsonl");
    const result = await modelTool.execute("model", { sessionId: "child", model: "test/new" }, undefined, undefined, ctx);
    expect(setModel).toHaveBeenCalledWith("parent-1", "child", "test/new", "/sessions/parent.jsonl");
    expect(result.details).toMatchObject({ sessionId: "child", model: "test/new", thinkingLevel: "low" });
    setModel.mockRejectedValueOnce(new Error("busy"));
    await expect(modelTool.execute("busy", { sessionId: "child", model: "test/new" }, undefined, undefined, ctx)).rejects.toThrow("busy");
    rename.mockRejectedValueOnce(new Error("not your child"));
    await expect(renameTool.execute("bad", { sessionId: "child", name: "Name" }, undefined, undefined, ctx)).rejects.toThrow("not your child");
  });

  it("describes tracked child work whose result remains available to the parent", async () => {
    const { spawn: spawnTool } = tools({
      spawn: vi.fn(() => Promise.resolve({ sessionId: "child-1", cwd: "/repos/a" })),
    });

    expect(spawnTool.description).toBe("Start a tracked child session in this session's workspace or another workspace of the same project to carry out part of the current task and return immediately. Its transcript and result are available here after it finishes.");
    expect(spawnTool.promptSnippet).toBe("spawn_subsession: tracked child work in a same-project workspace; result available after completion");
    expect(spawnTool.description).not.toMatch(/spawn_session|fully independent/i);

    const result = await spawnTool.execute("call-contract", { prompt: "do it" }, undefined, undefined, ctxFor("parent-1", undefined));
    expect(firstText(result.content)).toBe("Started tracked subsession child-1 in /repos/a. Continue other work, or end your turn with a brief close-out message. Completion notices wake you; do not poll.");
  });

  it("distinguishes status inspection from yielding in tool metadata", () => {
    const definitions = tools({});

    expect(definitions.list.description).toContain("List tracked child statuses");
    expect(definitions.list.promptSnippet).toBe("list_subsessions: inspect child statuses; never yields");
    expect(definitions.check.description).toContain("returning the child's complete latest final output marks that completion read");
    expect(definitions.check.description).toContain("transcript mode");
    expect(definitions.check.promptSnippet).toContain("never yields");
  });

  it("spawn_subsession omits the inherited model when the dispatching session has no current model", async () => {
    const spawn = vi.fn(() => Promise.resolve({ sessionId: "child-2", cwd: "/repos/a" }));
    const { spawn: spawnTool } = tools({ spawn });

    await spawnTool.execute("call-modeless", { prompt: "do it" }, undefined, undefined, ctxFor("parent-1", undefined));

    expect(spawn).toHaveBeenCalledWith({
      spawningCwd: "/repos/a",
      parentSessionId: "parent-1",
      parentSessionFile: undefined,
      prompt: "do it",
    });
  });

  it("spawn_subsession forwards an explicit model as a model spec and names the model used", async () => {
    const spawn = vi.fn(() => Promise.resolve({ sessionId: "child-3", cwd: "/repos/a", model: "openai/gpt-5" }));
    const { spawn: spawnTool } = tools({ spawn });

    const result = await spawnTool.execute("call-model", { prompt: "do it", model: "openai/gpt-5" }, undefined, undefined, ctxFor("parent-1", "/sessions/parent-1.jsonl", dispatchModel));

    expect(spawn).toHaveBeenCalledWith({
      spawningCwd: "/repos/a",
      parentSessionId: "parent-1",
      parentSessionFile: "/sessions/parent-1.jsonl",
      prompt: "do it",
      model: dispatchModel,
      modelSpec: "openai/gpt-5",
    });
    expect(result.details).toEqual({ sessionId: "child-3", cwd: "/repos/a", model: "openai/gpt-5" });
    expect(firstText(result.content)).toBe('Started tracked subsession child-3 in /repos/a using model "openai/gpt-5". Continue other work, or end your turn with a brief close-out message. Completion notices wake you; do not poll.');
  });

  it("spawn_subsession restricts model overrides to instructions without priming a concrete model", () => {
    const { spawn: spawnTool } = tools({});

    expect(spawnTool.parameters).toMatchObject({
      properties: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- stringMatching yields `any` against the loosely typed tool schema.
        model: { description: expect.stringMatching(/provider\/model-id.*only when instructed.*specific model.*choose an appropriate one.*omit it to inherit.*unknown value is rejected/si) },
      },
    });
    expect(JSON.stringify(spawnTool.parameters)).not.toContain("anthropic/claude-sonnet-4-5");
  });

  it.each(KNOWN_THINKING_LEVELS)("spawn_subsession overrides inherited thinking with %s without changing the parent", async (thinkingLevel) => {
    const spawn = vi.fn(() => Promise.resolve({ sessionId: "child", cwd: "/repos/a" }));
    const { spawn: tool } = tools({ spawn });
    const ctx = ctxFor("parent", undefined, dispatchModel, "high");
    const params = { prompt: "work", model: "openai/gpt-5", thinkingLevel };

    expect(Check(tool.parameters, params)).toBe(true);
    await tool.execute("call", params, undefined, undefined, ctx);

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ thinkingLevel, modelSpec: "openai/gpt-5" }));
    expect(ctx.thinkingLevel).toBe("high");
  });

  it("spawn_subsession makes thinking overrides instruction-only and rejects invalid levels in the tool schema", () => {
    const { spawn: tool } = tools({});
    expect(tool.parameters).toMatchObject({ properties: { thinkingLevel: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- asymmetric matcher against the tool schema.
      description: expect.stringMatching(/only when instructed.*specific thinking level.*choose an appropriate one.*omit it to inherit.*clamped/),
    } } });
    expect(Check(tool.parameters, { prompt: "work" })).toBe(true);
    for (const thinkingLevel of ["unknown", "", null, 1]) {
      expect(Check(tool.parameters, { prompt: "work", thinkingLevel })).toBe(false);
    }
  });

  it("list_subsessions reports the caller's subsessions and their status", async () => {
    const list = vi.fn(() => Promise.resolve([
      { sessionId: "child-1", cwd: "/repos/a", status: "working" as const },
      { sessionId: "child-2", cwd: "/repos/a", status: "idle" as const },
    ]));
    const { list: listTool } = tools({ list });

    const result = await listTool.execute("call-2", {}, undefined, undefined, ctxFor("parent-1", "/sessions/parent-1.jsonl"));

    expect(list).toHaveBeenCalledWith("parent-1", "/sessions/parent-1.jsonl");
    expect(result.details).toEqual({ subsessions: [
      { sessionId: "child-1", cwd: "/repos/a", status: "working" },
      { sessionId: "child-2", cwd: "/repos/a", status: "idle" },
    ] });
    expect(firstText(result.content)).toContain("child-1 [working]");
    expect(result.terminate).toBeUndefined();
  });

  it("list_subsessions renders names and labels cumulative tokens separately from context usage", async () => {
    const list = vi.fn(() => Promise.resolve([
      { sessionId: "child-1", cwd: "/repos/a", status: "idle" as const, name: "Worker Bee", model: "openai/gpt-5", thinkingLevel: "high", tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, total: 18 }, contextUsage: { tokens: 100, contextWindow: 1000, percent: 10 }, observedAt: "2026-01-01T00:02:00.000Z" },
      { sessionId: "child-2", cwd: "/repos/a", status: "idle" as const },
    ]));
    const { list: listTool } = tools({ list });
    const result = await listTool.execute("call-list-obs", {}, undefined, undefined, ctxFor("parent-1", "/sessions/parent-1.jsonl"));
    const text = firstText(result.content);
    expect(text).toContain('- "Worker Bee" (child-1) [idle] in /repos/a');
    expect(text).toContain("cumulative tokens 18 total (input 10, output 5, cache read 2, cache write 1)");
    expect(text).toContain("context usage 10% (100 tokens of 1000 context window)");
    expect(text).toContain("- child-2 [idle] in /repos/a");
    expect(text).not.toContain("Worker Bee (child-2)");
  });

  it("list_subsessions reports an empty state", async () => {
    const { list: listTool } = tools({ list: vi.fn(() => Promise.resolve([])) });
    const result = await listTool.execute("call-3", {}, undefined, undefined, ctxFor("parent-1", undefined));
    expect(result.content[0]).toMatchObject({ type: "text", text: "No tracked subsessions." });
    expect(result.terminate).toBeUndefined();
  });

  it("check_subsession scopes by parent and returns the final result", async () => {
    const check = vi.fn(() => Promise.resolve({ sessionId: "child-1", cwd: "/repos/a", status: "idle" as const, finalText: "all done", messageCount: 4 }));
    const { check: checkTool } = tools({ check });

    const result = await checkTool.execute("call-4", { sessionId: "child-1" }, undefined, undefined, ctxFor("parent-1", "/sessions/parent-1.jsonl"));

    expect(check).toHaveBeenCalledWith("parent-1", "child-1", "/sessions/parent-1.jsonl", "call-4", undefined);
    expect(result.details).toMatchObject({ sessionId: "child-1", status: "idle", finalText: "all done" });
    expect(firstText(result.content)).toBe("Subsession child-1 [idle].\n\n--- SUBSESSION OUTPUT: child-1 ---\nall done");
    expect(result.terminate).toBeUndefined();
  });

  it("check_subsession renders the name and observation labels", async () => {
    const check = vi.fn(() => Promise.resolve({ sessionId: "child-1", cwd: "/repos/a", status: "idle" as const, name: "Worker Bee", model: "openai/gpt-5", thinkingLevel: "low", tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 }, contextUsage: { tokens: null, contextWindow: 500, percent: null }, finalText: "done", messageCount: 1 }));
    const { check: checkTool } = tools({ check });
    const result = await checkTool.execute("call-check-obs", { sessionId: "child-1" }, undefined, undefined, ctxFor("parent-1", "/sessions/parent-1.jsonl"));
    const text = firstText(result.content);
    expect(text).toContain('Subsession "Worker Bee" (child-1) [idle].');
    expect(text).toContain('model "openai/gpt-5"');
    expect(text).toContain('thinking level "low"');
    expect(text).toContain("cumulative tokens 3 total");
    expect(text).toContain("context usage unknown percent (unknown tokens of 500 context window)");
  });

  it("check_subsession withholds partial working output without yielding", async () => {
    const partial = { sessionId: "child-1", cwd: "/repos/a", status: "working" as const, name: "Parser review", finalText: "SECRET PARTIAL OUTPUT", messageCount: 4 };
    const check = vi.fn(() => Promise.resolve(partial));
    const { check: checkTool } = tools({ check });

    const result = await checkTool.execute("call-working-check", { sessionId: "child-1" }, undefined, undefined, ctxFor("parent-1", "/sessions/parent-1.jsonl"));

    expect(check).toHaveBeenCalledWith("parent-1", "child-1", "/sessions/parent-1.jsonl", "call-working-check", undefined);
    expect(firstText(result.content)).toBe(workingGuidance('"Parser review" (child-1)'));
    expect(firstText(result.content)).not.toContain("SECRET PARTIAL OUTPUT");
    expect(result.details).toEqual(partial);
    expect(result.terminate).toBeUndefined();
  });

  it("check_subsession preserves non-working error output without yielding", async () => {
    const { check: checkTool } = tools({
      check: vi.fn(() => Promise.resolve({ sessionId: "child-1", cwd: "/repos/a", status: "error" as const, finalText: "child failed", messageCount: 3 })),
    });

    const result = await checkTool.execute("call-error-check", { sessionId: "child-1" }, undefined, undefined, ctxFor("parent-1", undefined));

    expect(firstText(result.content)).toBe("Subsession child-1 [error].\n\n--- SUBSESSION OUTPUT: child-1 ---\nchild failed");
    expect(result.terminate).toBeUndefined();
  });

  it("check_subsession propagates scope errors so the agent loop reports them", async () => {
    const check = vi.fn(() => Promise.reject(new Error("Session child-9 is not one of your subsessions")));
    const { check: checkTool } = tools({ check });

    await expect(checkTool.execute("call-5", { sessionId: "child-9" }, undefined, undefined, ctxFor("parent-1", undefined)))
      .rejects.toThrow("not one of your subsessions");
  });

  it("check_subsession transcript mode forwards filter params and renders the transcript", async () => {
    const read = vi.fn(() => Promise.resolve({
      sessionId: "child-1", cwd: "/repos/a", status: "idle" as const, name: "Worker Bee",
      entries: [{ index: 2, role: "assistant" as const, parts: [{ kind: "text" as const, text: "the answer" }] }],
      total: 5, matched: 2, start: 2, hasMore: true,
    }));
    const { read: readTool } = tools({ read });

    const result = await readTool.execute("call-6", { sessionId: "child-1", roles: ["assistant"], maxChars: 200, limit: 1 }, undefined, undefined, ctxFor("parent-1", "/sessions/parent-1.jsonl"));

    expect(read).toHaveBeenCalledWith("parent-1", "child-1", { roles: ["assistant"], maxChars: 200, limit: 1 }, "/sessions/parent-1.jsonl", "call-6");
    expect(result.details).toMatchObject({ sessionId: "child-1", matched: 2 });
    expect(firstText(result.content)).toBe('Subsession "Worker Bee" (child-1) [idle] — messages 2–2 of 5 (2 matched). Earlier matching messages exist before index 2.\n\n--- SUBSESSION TRANSCRIPT: child-1 ---\n#2 assistant\nthe answer');
    expect(result.terminate).toBeUndefined();
  });

  it("check_subsession transcript mode withholds partial working transcripts without yielding", async () => {
    const partial = {
      sessionId: "child-1", cwd: "/repos/a", status: "working" as const, name: "Parser review",
      entries: [{ index: 2, role: "assistant" as const, parts: [{ kind: "text" as const, text: "SECRET TRANSCRIPT ENTRY" }] }],
      total: 3, matched: 1, start: 2, hasMore: false,
    };
    const read = vi.fn(() => Promise.resolve(partial));
    const { read: readTool } = tools({ read });

    const result = await readTool.execute("call-working-read", { sessionId: "child-1", limit: 50 }, undefined, undefined, ctxFor("parent-1", "/sessions/parent-1.jsonl"));

    expect(read).toHaveBeenCalledWith("parent-1", "child-1", { limit: 50, maxChars: 4000 }, "/sessions/parent-1.jsonl", "call-working-read");
    expect(firstText(result.content)).toBe(workingGuidance('"Parser review" (child-1)'));
    expect(firstText(result.content)).not.toContain("SECRET TRANSCRIPT ENTRY");
    expect(result.details).toEqual(partial);
    expect(result.terminate).toBeUndefined();
  });

  it("check_subsession transcript mode renders raw tool-call args and the truncation marker in the model-facing text", async () => {
    const read = vi.fn(() => Promise.resolve({
      sessionId: "child-1", cwd: "/repos/a", status: "idle" as const,
      entries: [{
        index: 1, role: "assistant" as const, parts: [
          { kind: "tool_call" as const, toolName: "bash", summary: "ls", args: { command: "ls -la" } },
          { kind: "text" as const, text: "clipped", truncated: { shown: 7, full: 50 } },
        ],
      }],
      total: 3, matched: 1, start: 1, hasMore: false,
    }));
    const { read: readTool } = tools({ read });

    const result = await readTool.execute("call-7", { sessionId: "child-1", includeToolArgs: true }, undefined, undefined, ctxFor("parent-1", undefined));
    const text = firstText(result.content);
    expect(text).toContain("command"); // raw args surfaced in text, not only details
    expect(text).toContain("ls -la");
    expect(text).toContain("[+43 chars truncated"); // 50 - 7
    expect(result.terminate).toBeUndefined();
  });

  it("check_subsession transcript mode distinguishes an empty page-window from a zero-match result", async () => {
    const read = vi.fn(() => Promise.resolve({
      sessionId: "child-1", cwd: "/repos/a", status: "idle" as const,
      entries: [], total: 5, matched: 4, start: 0, hasMore: false,
    }));
    const { read: readTool } = tools({ read });

    const result = await readTool.execute("call-8", { sessionId: "child-1", before: 0 }, undefined, undefined, ctxFor("parent-1", undefined));
    const text = firstText(result.content);
    expect(text).toContain("4 matched"); // not "nothing matched"
    expect(text).not.toContain("nothing matched");
    expect(result.terminate).toBeUndefined();
  });

  it("check_subsession transcript mode propagates scope errors so the agent loop reports them", async () => {
    const read = vi.fn(() => Promise.reject(new Error("Session child-9 is not one of your subsessions")));
    const { read: readTool } = tools({ read });

    await expect(readTool.execute("call-9", { sessionId: "child-9", limit: 5 }, undefined, undefined, ctxFor("parent-1", undefined)))
      .rejects.toThrow("not one of your subsessions");
  });
});
