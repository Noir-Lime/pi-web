import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { JsonValue, PiWebHostStateV1 } from "../../server-plugin-api.js";
import { isPiWebPluginId } from "../../shared/pluginIds.js";

/** Maximum compact UTF-8 JSON payload accepted by the public state v1 capability. */
export const SERVER_PLUGIN_STATE_MAX_BYTES = 256 * 1024;
const SERVER_PLUGIN_STATE_MAX_DEPTH = 64;
const SERVER_PLUGIN_STATE_DIRECTORY = "plugin-state";
const SERVER_PLUGIN_STATE_FILENAME = "state.json";

export interface ServerPluginStatePersistence {
  read(): Promise<Uint8Array | undefined>;
  replace(contents: Uint8Array): Promise<void>;
  clear(): Promise<void>;
}

export interface ServerPluginStateStoreOptions {
  readonly pluginId: string;
  readonly lifetimeSignal: AbortSignal;
  readonly persistence: ServerPluginStatePersistence;
}

/**
 * One plugin's serialized durable JSON state. All admitted operations are
 * linearized, and closing the store revokes admission before draining work
 * that already reached the filesystem boundary.
 */
export class ServerPluginStateStore {
  private operationTail: Promise<void> = Promise.resolve();
  private accepting = true;
  private readonly abortListener = (): void => { this.accepting = false; };

  constructor(private readonly options: ServerPluginStateStoreOptions) {
    if (options.lifetimeSignal.aborted) this.accepting = false;
    else options.lifetimeSignal.addEventListener("abort", this.abortListener, { once: true });
  }

  capability(): PiWebHostStateV1 {
    return Object.freeze({
      version: 1,
      read: () => this.read(),
      write: (value: JsonValue) => this.write(value),
      clear: () => this.clear(),
    });
  }

  read(): Promise<JsonValue | undefined> {
    return this.enqueue(async () => {
      const contents = await this.options.persistence.read();
      if (contents === undefined) return undefined;
      if (contents.byteLength > SERVER_PLUGIN_STATE_MAX_BYTES) {
        throw this.corruptionError(`stored payload exceeds the ${String(SERVER_PLUGIN_STATE_MAX_BYTES)} byte limit`);
      }
      try {
        const source = new TextDecoder("utf-8", { fatal: true }).decode(contents);
        const parsed: unknown = JSON.parse(source);
        return snapshotJsonValue(parsed, "stored plugin state");
      } catch (error) {
        if (error instanceof ServerPluginStateCorruptionError) throw error;
        throw this.corruptionError(`stored payload violates the JSON boundary: ${errorMessage(error)}`, error);
      }
    });
  }

  write(value: JsonValue): Promise<void> {
    let contents: Uint8Array;
    try {
      this.assertAccepting();
      const snapshot = snapshotJsonValue(value, "plugin state");
      contents = new TextEncoder().encode(JSON.stringify(snapshot));
      if (contents.byteLength > SERVER_PLUGIN_STATE_MAX_BYTES) {
        throw new Error(`Server plugin state exceeds the ${String(SERVER_PLUGIN_STATE_MAX_BYTES)} byte limit`);
      }
    } catch (error) {
      return Promise.reject(toError(error));
    }
    return this.enqueue(() => this.options.persistence.replace(contents));
  }

  clear(): Promise<void> {
    return this.enqueue(() => this.options.persistence.clear());
  }

  async close(): Promise<void> {
    this.accepting = false;
    this.options.lifetimeSignal.removeEventListener("abort", this.abortListener);
    await this.operationTail;
  }

  private enqueue<Value>(operation: () => Value | Promise<Value>): Promise<Value> {
    try {
      this.assertAccepting();
    } catch (error) {
      return Promise.reject(toError(error));
    }
    const result = this.operationTail.then(async () => {
      this.assertAccepting();
      return await operation();
    });
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private assertAccepting(): void {
    if (!this.accepting || this.options.lifetimeSignal.aborted) {
      throw new Error(`Server plugin state for ${this.options.pluginId} is no longer active`);
    }
  }

  private corruptionError(message: string, cause?: unknown): ServerPluginStateCorruptionError {
    return new ServerPluginStateCorruptionError(
      `Server plugin state for ${this.options.pluginId} is corrupt: ${message}`,
      cause === undefined ? {} : { cause },
    );
  }
}

export class ServerPluginStateCorruptionError extends Error {
  override name = "ServerPluginStateCorruptionError";
}

export function serverPluginStateFilePath(dataDir: string, pluginId: string): string {
  if (!isPiWebPluginId(pluginId)) throw new Error(`Invalid PI WEB plugin id for durable state: ${pluginId}`);
  const stateRoot = resolve(dataDir, SERVER_PLUGIN_STATE_DIRECTORY);
  const filePath = resolve(stateRoot, pluginId, SERVER_PLUGIN_STATE_FILENAME);
  const childPath = relative(stateRoot, filePath);
  if (childPath === "" || childPath.startsWith("..") || isAbsolute(childPath)) {
    throw new Error(`PI WEB plugin state path escapes the host-owned state root: ${pluginId}`);
  }
  return filePath;
}

export function createFileServerPluginStatePersistence(filePath: string): ServerPluginStatePersistence {
  return Object.freeze({
    read: () => readBoundedFile(filePath),
    replace: (contents: Uint8Array) => atomicReplace(filePath, contents),
    clear: () => clearFile(filePath),
  });
}

async function readBoundedFile(filePath: string): Promise<Uint8Array | undefined> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, "r");
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) return undefined;
    throw error;
  }
  try {
    const contents = Buffer.allocUnsafe(SERVER_PLUGIN_STATE_MAX_BYTES + 1);
    let offset = 0;
    while (offset < contents.byteLength) {
      const { bytesRead } = await handle.read(contents, offset, contents.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return contents.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

async function atomicReplace(filePath: string, contents: Uint8Array): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(
    directory,
    `.${basename(filePath)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
    await syncDirectory(directory);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function clearFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) return;
    throw error;
  }
  await syncDirectory(dirname(filePath));
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    // Windows does not support opening directories as file handles. The temp
    // file fsync and atomic rename still prevent partially written JSON there.
    if (process.platform !== "win32") throw error;
  } finally {
    await handle?.close();
  }
}

function snapshotJsonValue(value: unknown, label: string): JsonValue {
  return cloneJsonValue(value, new Set<object>(), label, 0);
}

function cloneJsonValue(
  value: unknown,
  ancestors: Set<object>,
  label: string,
  depth: number,
): JsonValue {
  if (depth > SERVER_PLUGIN_STATE_MAX_DEPTH) {
    throw new Error(`${label} exceeds the maximum JSON depth of ${String(SERVER_PLUGIN_STATE_MAX_DEPTH)}`);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} must contain only finite JSON numbers`);
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error(`${label} must not contain cycles`);
    ancestors.add(value);
    try {
      const output: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new Error(`${label} must not contain sparse arrays`);
        output[index] = cloneJsonValue(value[index], ancestors, label, depth + 1);
      }
      return Object.freeze(output);
    } finally {
      ancestors.delete(value);
    }
  }
  if (!isPlainRecord(value)) throw new Error(`${label} must contain only JSON values`);
  if (ancestors.has(value)) throw new Error(`${label} must not contain cycles`);
  ancestors.add(value);
  try {
    const output: Record<string, JsonValue> = {};
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      Object.defineProperty(output, key, {
        value: cloneJsonValue(value[key], ancestors, label, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(value);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error), { cause: error });
}
