import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { PiSessionService, type PiSessionManager } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

/**
 * Regression for the stale-offset bug: a lazy SessionManager indexes entries by
 * byte offset, so rewriting the header underneath it breaks every later
 * uncached read. This runs the real lazy store (the Pi Stack overlay copied
 * over a pinned Pi package) and skips when that checkout is not available.
 */
const overlayDir = process.env["PI_STACK_OVERLAY_DIR"] ?? join(homedir(), "Work/pi-stack/overlays/@earendil-works/pi-coding-agent/dist/core");

function releaseModules(): string | undefined {
  const fromEnv = process.env["PI_STACK_RELEASE"];
  try {
    const applied: unknown = JSON.parse(readFileSync(join(homedir(), ".local/state/pi-stack/applied.json"), "utf8"));
    const appliedRelease = typeof applied === "object" && applied !== null && "release" in applied && typeof applied.release === "string" ? applied.release : undefined;
    const release = fromEnv ?? appliedRelease;
    return release === undefined ? undefined : join(release, "runtime/node_modules");
  } catch {
    return undefined;
  }
}

const modules = releaseModules();
const available = modules !== undefined && existsSync(join(overlayDir, "session-manager.js"));
const work = mkdtempSync(join(tmpdir(), "pi-web-detach-real-"));
afterAll(() => { rmSync(work, { recursive: true, force: true }); });

interface RealManager extends PiSessionManager {
  getEntries(): unknown[];
  buildSessionProjection(): unknown;
  buildSessionContext(): unknown;
}
interface RealManagerClass {
  open(path: string, sessionDir?: string): RealManager;
}

function realManagerClass(value: unknown): RealManagerClass {
  if (typeof value !== "function") throw new Error("SessionManager is unavailable");
  return {
    open: (path, sessionDir) => {
      const open: unknown = Reflect.get(value, "open");
      if (typeof open !== "function") throw new Error("SessionManager.open is unavailable");
      const opened: unknown = Reflect.apply(open, value, [path, sessionDir]);
      if (!isRealManager(opened)) throw new Error("SessionManager.open returned an unexpected value");
      return opened;
    },
  };
}

function isRealManager(value: unknown): value is RealManager {
  return typeof value === "object" && value !== null && "getEntries" in value && "buildSessionProjection" in value;
}

async function loadRealStore(): Promise<RealManagerClass> {
  if (modules === undefined) throw new Error("Pi Stack release unavailable");
  const pkg = join(work, "coding-agent");
  cpSync(join(modules, "@earendil-works/pi-coding-agent"), pkg, { recursive: true });
  symlinkSync(modules, join(work, "node_modules"));
  copyFileSync(join(overlayDir, "session-manager.js"), join(pkg, "dist/core/session-manager.js"));
  const loaded: unknown = await import(pathToFileURL(join(pkg, "dist/core/session-manager.js")).href);
  if (typeof loaded !== "object" || loaded === null || !("SessionManager" in loaded)) throw new Error("Overlay session-manager did not export SessionManager");
  return realManagerClass(loaded.SessionManager);
}

function writeSession(path: string, parentSession: string): void {
  const lines: unknown[] = [{ type: "session", version: 3, id: "child-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace", parentSession }];
  let parent: string | null = null;
  for (let index = 0; index < 12; index += 1) {
    const id = `m${String(index)}`;
    lines.push({ type: "message", id, parentId: parent, timestamp: "2026-01-01T00:00:01.000Z", message: { role: index % 2 === 0 ? "user" : "assistant", content: [{ type: "text", text: `héllo 日本語 ${String(index)}` }], timestamp: 1000 + index } });
    parent = id;
  }
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
}

function plain(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

describe.skipIf(!available)("detachParent over the real lazy store", () => {
  it("keeps every uncached read valid and equal to a freshly opened manager", async () => {
    const Store = await loadRealStore();
    const file = join(work, "child.jsonl");
    writeSession(file, "/tmp/parent-session.jsonl");
    const live = Store.open(file, work);
    // Nothing is cached yet, so every read below must go through the stored offsets.
    const fake = fakeRuntime("child-1", { sessionFile: file, sessionManager: live });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: "/tmp/pi-web-test-agent",
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("child-1")]),
      heartbeatIntervalMs: 60_000,
    });
    try {
      await service.detachParent(sessionRef("child-1"));
      expect(readFileSync(file, "utf8").split("\n")[0]).not.toContain("parentSession");
      expect(live.getHeader?.()?.parentSession).toBeUndefined();

      const fresh = Store.open(file, work);
      expect(plain(live.getEntries())).toEqual(plain(fresh.getEntries()));
      expect(plain(live.getBranch())).toEqual(plain(fresh.getBranch()));
      for (const entry of fresh.getEntries()) {
        if (typeof entry !== "object" || entry === null || !("id" in entry) || typeof entry.id !== "string") throw new Error("Entry without id");
        const id = entry.id;
        expect(plain(live.getEntry?.(id))).toEqual(plain(fresh.getEntry?.(id)));
      }
      expect(plain(live.buildSessionProjection())).toEqual(plain(fresh.buildSessionProjection()));
      expect(plain(live.buildSessionContext())).toEqual(plain(fresh.buildSessionContext()));
    } finally {
      await service.dispose();
    }
  });
});
