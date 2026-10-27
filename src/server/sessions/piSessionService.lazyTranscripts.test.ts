import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PiSessionService, type PiEntryDescriptor, type PiSessionManager } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, fakeSessionManager, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

interface TestEntry extends Record<string, unknown> { id: string; message: { role: string; content: { type: string; text: string }[] } }

function entry(id: string, role: string, text: string): TestEntry {
  return { type: "message", id, parentId: "root", timestamp: "2026-01-01T00:00:00.000Z", message: { role, content: [{ type: "text", text }] } };
}

function descriptor(id: string, type: string, extra: Partial<PiEntryDescriptor> = {}): PiEntryDescriptor {
  return { id, parentId: "root", type, timestamp: "2026-01-01T00:00:00.000Z", bytes: 10, textChars: 0, imageCount: 0, hasThinkingSignature: false, ...extra };
}

function lazyManager(entries: TestEntry[], descriptors: PiEntryDescriptor[]) {
  const getEntry = vi.fn((id: string) => entries.find((candidate) => candidate.id === id));
  const getBranch = vi.fn((): unknown[] => { throw new Error("getBranch must not hydrate the transcript"); });
  const manager: PiSessionManager = fakeSessionManager("/workspace", {
    getBranch,
    getEntry,
    getBranchDescriptors: () => descriptors,
    getDescriptors: () => descriptors,
    getContextDescriptors: () => descriptors,
  });
  return { manager, getEntry, getBranch };
}

function serviceWith(manager: PiSessionManager, patch: Parameters<typeof fakeRuntime>[1] = {}) {
  const fake = fakeRuntime("session-1", { sessionFile: "/tmp/session-1.jsonl", sessionManager: manager, ...patch });
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(fake.runtime),
    sessionManager: sessionGateway([sessionRecord("session-1")]),
    heartbeatIntervalMs: 60_000,
  });
  return { fake, service };
}

describe("PiSessionService lazy transcript paths", () => {
  it("pages from descriptors and reads only the page bodies, with the thinking level in effect", async () => {
    const entries = [entry("e1", "user", "one"), entry("e2", "assistant", "two"), entry("e3", "user", "three"), entry("e4", "assistant", "four"), entry("e5", "user", "five"), entry("e6", "assistant", "six")];
    const descriptors: PiEntryDescriptor[] = [
      descriptor("t1", "thinking_level_change", { thinkingLevel: "high" }),
      descriptor("c1", "custom_message", { customType: "hidden", display: false }),
      ...entries.map((candidate) => descriptor(candidate.id, "message", { role: candidate.message.role })),
    ];
    const { manager, getEntry, getBranch } = lazyManager(entries, descriptors);
    const { service } = serviceWith(manager);
    try {
      const page = await service.messages(sessionRef("session-1"), { limit: 2 });
      expect(page.total).toBe(6);
      expect(page.start).toBe(4);
      expect(page.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "five" }], entryId: "e5" },
        { role: "assistant", content: [{ type: "text", text: "six" }], thinkingLevel: "high", entryId: "e6" },
      ]);
      expect(getEntry.mock.calls.map(([id]) => id)).toEqual(["e5", "e6"]);
      expect(getBranch).not.toHaveBeenCalled();
    } finally {
      await service.dispose();
    }
  });

  it("fails explicitly when a custom message descriptor has no display flag", async () => {
    const entries = [entry("e1", "user", "one")];
    const descriptors = [descriptor("c1", "custom_message", { customType: "x" }), descriptor("e1", "message", { role: "user" })];
    const { manager } = lazyManager(entries, descriptors);
    const { service } = serviceWith(manager);
    try {
      await expect(service.messages(sessionRef("session-1"))).rejects.toThrow("missing its display flag");
    } finally {
      await service.dispose();
    }
  });

  it("counts status messages from the index without reading the branch", async () => {
    const entries = [entry("e1", "user", "one"), entry("e2", "assistant", "two"), entry("e3", "user", "three")];
    const descriptors = entries.map((candidate) => descriptor(candidate.id, "message", { role: candidate.message.role }));
    const { manager, getBranch } = lazyManager(entries, descriptors);
    const { service } = serviceWith(manager);
    try {
      const snapshot = await service.transcriptSnapshot(sessionRef("session-1"));
      expect(snapshot.status.messageCount).toBe(3);
      expect(snapshot.page.total).toBe(3);
      expect(getBranch).not.toHaveBeenCalled();
    } finally {
      await service.dispose();
    }
  });

  it("detaches by streaming the file and never mutates the shared header object", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-detach-"));
    const sessionFile = join(dir, "child.jsonl");
    const body = JSON.stringify({ type: "message", id: "m1", parentId: null, message: { role: "user", content: "hi" } });
    await writeFile(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "child", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace", parentSession: "/tmp/parent.jsonl" })}\n${body}\n`, "utf8");
    const sharedHeader = { parentSession: "/tmp/parent.jsonl", timestamp: "2026-01-01T00:00:00.000Z" };
    const manager = fakeSessionManager("/workspace", { getHeader: () => sharedHeader });
    const { service } = serviceWith(manager, { sessionFile });
    try {
      await service.detachParent(sessionRef("session-1"));
      const [headerLine, ...rest] = (await readFile(sessionFile, "utf8")).split("\n");
      expect(JSON.parse(headerLine ?? "{}")).not.toHaveProperty("parentSession");
      expect(rest.join("\n")).toContain(body);
      expect(sharedHeader.parentSession).toBe("/tmp/parent.jsonl");
    } finally {
      await service.dispose();
    }
  });
});
