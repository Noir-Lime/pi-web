import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFileServerPluginStatePersistence,
  SERVER_PLUGIN_STATE_MAX_BYTES,
  serverPluginStateFilePath,
  type ServerPluginStatePersistence,
  ServerPluginStateStore,
} from "./serverPluginStateStore.js";

const tempRoots: string[] = [];

beforeEach(() => {
  tempRoots.splice(0);
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("serverPluginStateFilePath", () => {
  it("derives a contained host-owned namespace from the validated plugin id", () => {
    const dataDir = resolve("/tmp/pi-web-data");
    expect(serverPluginStateFilePath(dataDir, "example.tools")).toBe(
      join(dataDir, "plugin-state", "example.tools", "state.json"),
    );
    expect(serverPluginStateFilePath(dataDir, "other-tools")).not.toBe(
      serverPluginStateFilePath(dataDir, "example.tools"),
    );
    expect(() => serverPluginStateFilePath(dataDir, "../escape"))
      .toThrow("Invalid PI WEB plugin id for durable state");
  });
});

describe("ServerPluginStateStore", () => {
  it("persists detached JSON across store instances and clears idempotently", async () => {
    const { filePath, state, store } = await fileStore("persistent");
    const input = { revision: 1, nested: ["initial"] };
    const writing = state.write(input);
    input.revision = 2;
    input.nested.push("mutated");
    await writing;

    const firstRead = await state.read();
    expect(firstRead).toEqual({ revision: 1, nested: ["initial"] });
    expect(Object.isFrozen(firstRead)).toBe(true);
    if (typeof firstRead !== "object" || firstRead === null) throw new Error("Expected object state");
    expect(Object.isFrozen(Reflect.get(firstRead, "nested"))).toBe(true);
    await store.close();

    const reloadController = new AbortController();
    const reloaded = new ServerPluginStateStore({
      pluginId: "persistent",
      lifetimeSignal: reloadController.signal,
      persistence: createFileServerPluginStatePersistence(filePath),
    });
    expect(await reloaded.read()).toEqual({ revision: 1, nested: ["initial"] });
    await reloaded.clear();
    await reloaded.clear();
    expect(await reloaded.read()).toBeUndefined();
    await reloaded.close();
  });

  it("enforces the compact UTF-8 quota and rejects values outside the JSON boundary", async () => {
    const { state, store } = await fileStore("bounded");
    await state.write("x".repeat(SERVER_PLUGIN_STATE_MAX_BYTES - 2));
    await expect(state.write("x".repeat(SERVER_PLUGIN_STATE_MAX_BYTES - 1)))
      .rejects.toThrow(`${String(SERVER_PLUGIN_STATE_MAX_BYTES)} byte limit`);

    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const sparse: unknown[] = [];
    sparse.length = 1;
    let tooDeep: unknown = null;
    for (let depth = 0; depth < 65; depth += 1) tooDeep = [tooDeep];
    for (const invalid of [undefined, Number.NaN, new Date(), circular, sparse, tooDeep, 1n]) {
      const writing: unknown = Reflect.apply(state.write, state, [invalid]);
      if (!(writing instanceof Promise)) throw new Error("State write did not return a promise");
      await expect(writing).rejects.toThrow(/JSON|finite|cycles|sparse|maximum JSON depth/u);
    }
    await store.close();
  });

  it("reports corrupt persisted data without replacing it", async () => {
    const root = await tempRoot();
    const filePath = serverPluginStateFilePath(root, "corrupt");
    await writeFileWithParents(filePath, "{not-json");
    const controller = new AbortController();
    const store = new ServerPluginStateStore({
      pluginId: "corrupt",
      lifetimeSignal: controller.signal,
      persistence: createFileServerPluginStatePersistence(filePath),
    });

    await expect(store.read()).rejects.toThrow("Server plugin state for corrupt is corrupt");
    expect(await readFile(filePath, "utf8")).toBe("{not-json");

    const oversized = Buffer.alloc(SERVER_PLUGIN_STATE_MAX_BYTES + 1, 0x20);
    await writeFile(filePath, oversized);
    await expect(store.read()).rejects.toThrow(`${String(SERVER_PLUGIN_STATE_MAX_BYTES)} byte limit`);
    expect((await stat(filePath)).size).toBe(oversized.byteLength);
    await store.close();
  });

  it("serializes mutations in admission order and revokes queued work on lifetime cancellation", async () => {
    const events: string[] = [];
    let persisted: Uint8Array | undefined;
    let releaseFirst = (): void => undefined;
    const firstGate = new Promise<void>((resolvePromise) => { releaseFirst = resolvePromise; });
    let replacements = 0;
    const persistence: ServerPluginStatePersistence = {
      read: () => Promise.resolve(persisted),
      async replace(contents) {
        replacements += 1;
        const sequence = stateSequence(contents);
        events.push(`replace:start:${String(sequence)}`);
        if (replacements === 1) await firstGate;
        persisted = contents;
        events.push(`replace:end:${String(sequence)}`);
      },
      clear() {
        events.push("clear");
        persisted = undefined;
        return Promise.resolve();
      },
    };
    const controller = new AbortController();
    const store = new ServerPluginStateStore({ pluginId: "serialized", lifetimeSignal: controller.signal, persistence });
    const state = store.capability();

    const first = state.write({ sequence: 1 });
    const second = state.write({ sequence: 2 });
    await vi.waitFor(() => { expect(events).toEqual(["replace:start:1"]); });
    controller.abort(new DOMException("shutdown", "AbortError"));
    releaseFirst();

    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toThrow("is no longer active");
    await expect(state.clear()).rejects.toThrow("is no longer active");
    await store.close();
    expect(events).toEqual(["replace:start:1", "replace:end:1"]);
    expect(stateSequence(persisted)).toBe(1);
  });

  it.skipIf(process.platform === "win32")("keeps the previous value when an atomic replacement cannot create its temp file", async () => {
    const { filePath, state, store } = await fileStore("atomic-failure");
    await state.write({ revision: 1 });
    const directory = dirname(filePath);
    await chmod(directory, 0o500);
    try {
      await expect(state.write({ revision: 2 })).rejects.toThrow();
      expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ revision: 1 });
    } finally {
      await chmod(directory, 0o700);
    }
    await state.write({ revision: 3 });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ revision: 3 });
    expect(await readdir(directory)).toEqual(["state.json"]);
    expect((await stat(filePath)).isFile()).toBe(true);
    await store.close();
  });
});

async function fileStore(pluginId: string): Promise<{
  filePath: string;
  state: ReturnType<ServerPluginStateStore["capability"]>;
  store: ServerPluginStateStore;
}> {
  const root = await tempRoot();
  const filePath = serverPluginStateFilePath(root, pluginId);
  const controller = new AbortController();
  const store = new ServerPluginStateStore({
    pluginId,
    lifetimeSignal: controller.signal,
    persistence: createFileServerPluginStatePersistence(filePath),
  });
  return { filePath, state: store.capability(), store };
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-plugin-state-test-"));
  tempRoots.push(root);
  return root;
}

async function writeFileWithParents(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

function stateSequence(contents: Uint8Array | undefined): number | undefined {
  if (contents === undefined) return undefined;
  const parsed: unknown = JSON.parse(new TextDecoder().decode(contents));
  if (typeof parsed !== "object" || parsed === null || !("sequence" in parsed)) return undefined;
  const sequence: unknown = parsed.sequence;
  return typeof sequence === "number" ? sequence : undefined;
}
