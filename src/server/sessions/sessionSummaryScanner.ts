import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isRecord, tryParseEntry } from "./sessionFileFormat.js";
import type { PiSessionListEntry } from "./piSessionService.js";

/*
 * LISTING CONTRACT
 *
 * The summary fields mirror the SDK listing (`SessionManager.listAll`):
 * `messageCount` counts every `message` entry, `firstMessage` is the first
 * user message with non-empty text content, `name` is the latest `session_info`
 * name (an empty or missing name clears it), and `created`/`id`/`cwd`/
 * `parentSessionPath` come from the header line. Three deliberate differences:
 *
 * - `modified` is the file mtime rather than the last message timestamp.
 *   Session files are append-only, so the mtime is a faithful "last activity"
 *   for listing order, the only thing `modified` is used for.
 * - `allMessagesText` is always empty. Building it required parsing every
 *   message body — the cost this scanner exists to remove — and PI WEB never
 *   consumes it.
 * - `messageCount` can transiently include a final write read mid-flight: a
 *   message-shaped line that ends with `}` counts even though its JSON is
 *   never validated, where the SDK fails to parse such a torn line. The count
 *   self-heals on the next listing once the line completes (the file is
 *   re-scanned whole as soon as its size changes).
 *
 * Files whose header is missing, unreadable, or not a session header are
 * skipped, like the SDK does. Results are sorted by `modified` descending.
 *
 * Per-line work is minimal: lines are classified from their leading
 * `{"type":"..."` bytes without ever decoding them, and lines are only turned
 * into strings and JSON-parsed when they matter — the header, `session_info`
 * lines (rare, one per rename), and message lines until the first user text
 * message has been found. Message bodies after that point (which hold the huge
 * tool results and assistant replies) are neither decoded nor parsed.
 */

/**
 * Fast-path classification prefix of a session file line, as raw bytes.
 *
 * The Pi SDK writes every entry with `type` as the first JSON key, so the
 * entry type can normally be read directly from the line's first bytes without
 * decoding or parsing it. This is what lets a listing skip the (potentially
 * huge) message bodies entirely: only lines whose type actually matters for
 * the summary are ever decoded to strings and JSON-parsed.
 */
const ENTRY_TYPE_PREFIX = Buffer.from('{"type":"');
const TYPE_QUOTE = 0x22; // `"`
const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const CLOSING_BRACE = 0x7d; // `}`
const SPACE = 0x20;
const TAB = 0x09;

/** The entry types the byte fast path recognizes, as raw bytes: type names are never decoded. */
const MESSAGE_TYPE_BYTES = Buffer.from("message");
const SESSION_INFO_TYPE_BYTES = Buffer.from("session_info");

/** Same bound the SDK uses for its concurrent session-info builds. */
const MAX_CONCURRENT_SESSION_SUMMARY_SCANS = 10;

/** Default read chunk size for the streaming pass; see SessionSummaryScannerOptions. */
const SCAN_CHUNK_BYTES = 4 * 1024 * 1024;

/** Types longer than this fall back to a full parse instead of byte classification. */
const MAX_CLASSIFIED_TYPE_LENGTH = 64;

/** Bytes hashed at the start of a file and just before its checkpoint offset to validate a persisted summary. */
const CHECKPOINT_WINDOW_BYTES = 4096;

/** Version of the persisted summary index format; any other version is ignored and rebuilt. */
const SUMMARY_INDEX_VERSION = 1;

/** Construction options for {@link SessionSummaryScanner}. */
export interface SessionSummaryScannerOptions {
  /**
   * Read chunk size for the streaming pass. Defaults to 4 MiB. Tests shrink
   * this to exercise multi-chunk line folding with small files; production
   * callers leave it unset.
   */
  readonly chunkBytes?: number;
  /**
   * Directory for persisted summary indexes (one small JSON file per session
   * directory). When set, summaries survive process restarts, so a restarted
   * daemon validates each file with a stat and two 4 KiB reads instead of
   * re-reading whole transcripts. Unset keeps the summaries in memory only.
   */
  readonly indexDir?: string;
}

/**
 * Session summary scanner that maintains each session file's listing summary
 * as an incrementally updated projection of the transcript: the transcript is
 * the only source of truth, and the summary is a fold of its lines plus a
 * checkpoint recording exactly which bytes were folded.
 *
 * Per file the scanner records the file identity (dev/ino), the observed size
 * and mtime, the checkpoint offset (just past the last complete line folded),
 * SHA-256 hashes of the first and of the last {@link CHECKPOINT_WINDOW_BYTES}
 * before that offset, and the fold state at the offset. A trailing line without
 * a newline is folded into the listing result but never into the checkpoint, so
 * a line still being written is counted exactly once after it completes.
 *
 * On each listing:
 * - Identity, size, and mtime unchanged, and the entry already validated in
 *   this process → summary from memory (one stat, no read).
 * - Identity unchanged, file at least as large as the offset, same-size files
 *   with an unchanged mtime, and both checkpoint hashes still match → the
 *   folded bytes are unchanged: only bytes after the offset are read and
 *   folded (nothing, when the file did not grow).
 * - Anything else (new file, replaced inode, truncation, same-size rewrite,
 *   changed header or checkpointed tail, rejected file that changed) → the
 *   entry is rebuilt from the whole file.
 * - File gone → its entry is dropped; entries for files that no longer appear
 *   in the directory are pruned on each scan.
 *
 * With {@link SessionSummaryScannerOptions.indexDir}, entries are persisted per
 * session directory with an atomic write and loaded lazily on first listing.
 * Persisted entries are always revalidated against their file before use, and
 * a missing, corrupt, or foreign-version index is simply rebuilt, so the index
 * can never be more authoritative than the transcripts it summarizes.
 *
 * The checkpoint cannot detect an edit strictly between the first and last
 * checkpoint windows that keeps the size and restores the exact mtime, or that
 * is followed by an append. The SDK only appends; PI WEB's detach rewrites the
 * header in place and calls {@link invalidate}; {@link clear} remains the
 * escape hatch for unknown external rewrites.
 */
export class SessionSummaryScanner {
  private readonly memo = new Map<string, SessionSummaryEntry>();
  private readonly chunkBytes: number;
  private readonly indexDir: string | undefined;
  private readonly loadedDirs = new Map<string, Promise<void>>();
  private readonly dirtyDirs = new Set<string>();

  constructor(options: SessionSummaryScannerOptions = {}) {
    const chunkBytes = options.chunkBytes ?? SCAN_CHUNK_BYTES;
    if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) {
      throw new TypeError(`SessionSummaryScanner options.chunkBytes must be a positive integer, got ${String(chunkBytes)}`);
    }
    this.chunkBytes = chunkBytes;
    this.indexDir = options.indexDir;
  }

  /** Drop every cached summary, forcing full re-parses on the next listing. */
  clear(): void {
    for (const path of this.memo.keys()) this.dirtyDirs.add(dirname(path));
    this.memo.clear();
  }

  /**
   * Drop the cached summary for one file, forcing a full re-parse of it on
   * the next listing. Callers that rewrite a session file in place (keeping
   * the inode) must invalidate it. Dropping a path that is not cached is a no-op.
   */
  invalidate(filePath: string): void {
    if (this.memo.delete(filePath)) this.dirtyDirs.add(dirname(filePath));
  }

  /**
   * List the sessions in one session directory. Unchanged files are answered
   * from their summaries, grown files fold only their appended bytes, and only
   * new or rewritten files are read whole (see the class docs).
   */
  async scanSessionSummariesInDir(sessionDir: string): Promise<PiSessionListEntry[]> {
    await this.loadIndex(sessionDir);
    const files = await listSessionFilesInDir(sessionDir);
    this.pruneEntriesRemovedFrom(sessionDir, files);
    const summaries = await scanSessionFilesWithBoundedConcurrency(files, this.chunkBytes, (file, chunkBuffer) => this.scanFile(file, chunkBuffer));
    await this.saveIndex(sessionDir);
    return sortedSessionSummaries(summaries);
  }

  private pruneEntriesRemovedFrom(sessionDir: string, existingFiles: readonly string[]): void {
    const existing = new Set(existingFiles);
    for (const path of this.memo.keys()) {
      if (dirname(path) === sessionDir && !existing.has(path)) {
        this.memo.delete(path);
        this.dirtyDirs.add(sessionDir);
      }
    }
  }

  private async scanFile(filePath: string, chunkBuffer: () => Buffer): Promise<PiSessionListEntry | undefined> {
    const cached = this.memo.get(filePath);
    if (cached?.summaryFold !== undefined) {
      let stats: Stats;
      try {
        stats = await stat(filePath);
      } catch {
        this.forget(filePath);
        return undefined;
      }
      // Validated in this process and untouched since: no open, no read.
      if (sameObservedFile(cached, stats)) return buildSummaryFromFold(cached.summaryFold, filePath, stats.mtime);
    }

    const opened = await openSessionFile(filePath);
    if (opened === undefined) {
      this.forget(filePath);
      return undefined;
    }
    try {
      const refreshed = await refreshEntry(opened.file, opened.stats, cached, chunkBuffer);
      if (refreshed === undefined) {
        this.forget(filePath);
        return undefined;
      }
      if (refreshed.changed) this.dirtyDirs.add(dirname(filePath));
      this.memo.set(filePath, refreshed.entry);
      return buildSummaryFromFold(refreshed.summaryFold, filePath, opened.stats.mtime);
    } catch {
      this.forget(filePath);
      return undefined;
    } finally {
      await opened.file.close().catch(() => undefined);
    }
  }

  private forget(filePath: string): void {
    if (this.memo.delete(filePath)) this.dirtyDirs.add(dirname(filePath));
  }

  private loadIndex(sessionDir: string): Promise<void> {
    if (this.indexDir === undefined) return Promise.resolve();
    const existing = this.loadedDirs.get(sessionDir);
    if (existing !== undefined) return existing;
    const loading = readSummaryIndex(summaryIndexPath(this.indexDir, sessionDir), sessionDir).then((entries) => {
      for (const [fileName, entry] of entries) {
        const path = join(sessionDir, fileName);
        // Summaries already built in this process are at least as fresh.
        if (!this.memo.has(path)) this.memo.set(path, entry);
      }
    });
    this.loadedDirs.set(sessionDir, loading);
    return loading;
  }

  private async saveIndex(sessionDir: string): Promise<void> {
    if (this.indexDir === undefined || !this.dirtyDirs.has(sessionDir)) return;
    this.dirtyDirs.delete(sessionDir);
    const files: Record<string, PersistedSessionSummary> = {};
    for (const [path, entry] of this.memo) {
      if (dirname(path) === sessionDir) files[basename(path)] = persistedEntry(entry);
    }
    // The index is a disposable cache: a failed write only costs a rebuild later.
    await writeSummaryIndex(summaryIndexPath(this.indexDir, sessionDir), { version: SUMMARY_INDEX_VERSION, sessionDir, files }).catch(() => {
      this.dirtyDirs.add(sessionDir);
    });
  }
}

/** One file's projection state: the checkpoint that validates it and the fold it summarizes. */
interface SessionSummaryEntry {
  dev: number;
  ino: number;
  /** File size observed when the entry was last refreshed. */
  size: number;
  /** mtime (ms, with sub-ms precision) observed when the entry was last refreshed. */
  mtimeMs: number;
  /** Byte offset just past the last complete line folded into {@link fold}. */
  offset: number;
  /** SHA-256 of the first min(window, offset) bytes. */
  headHash: string;
  /** SHA-256 of the window of bytes ending at {@link offset}. */
  tailHash: string;
  /** Fold of exactly the bytes before {@link offset}. */
  fold: SummaryFoldState;
  /**
   * Fold including any unterminated trailing line, present once the entry has
   * been validated against its file in this process. Never persisted.
   */
  summaryFold?: SummaryFoldState;
}

type PersistedSessionSummary = Omit<SessionSummaryEntry, "summaryFold">;

interface SummaryIndexFile {
  version: number;
  sessionDir: string;
  files: Record<string, PersistedSessionSummary>;
}

/** The summary-relevant state accumulated while folding a file's lines. */
interface SummaryFoldState {
  header: Record<string, unknown> | undefined;
  rejected: boolean;
  messageCount: number;
  firstMessageText: string | undefined;
  name: string | undefined;
}

function createEmptyFold(): SummaryFoldState {
  return { header: undefined, rejected: false, messageCount: 0, firstMessageText: undefined, name: undefined };
}

function cloneFold(fold: SummaryFoldState): SummaryFoldState {
  return { ...fold, header: fold.header === undefined ? undefined : { ...fold.header } };
}

function sameObservedFile(entry: SessionSummaryEntry, stats: Stats): boolean {
  return entry.dev === stats.dev && entry.ino === stats.ino && entry.size === stats.size && entry.mtimeMs === stats.mtimeMs;
}

/** Open a session file for reading and fstat the opened handle. */
async function openSessionFile(filePath: string): Promise<{ file: FileHandle; stats: Stats } | undefined> {
  let file: FileHandle | undefined;
  try {
    file = await open(filePath, "r");
  } catch {
    return undefined;
  }
  try {
    const stats = await file.stat();
    return { file, stats };
  } catch {
    await file.close().catch(() => undefined);
    return undefined;
  }
}

interface RefreshedEntry {
  entry: SessionSummaryEntry;
  summaryFold: SummaryFoldState;
  /** Whether the persisted fields differ from the entry passed in. */
  changed: boolean;
}

/**
 * Bring one file's entry up to date against the open handle (never the path,
 * so a concurrent replacement is described by the file actually read).
 * Resumes from the checkpoint when it still validates; otherwise rebuilds.
 */
async function refreshEntry(file: FileHandle, stats: Stats, cached: SessionSummaryEntry | undefined, chunkBuffer: () => Buffer): Promise<RefreshedEntry | undefined> {
  if (cached?.dev === stats.dev && cached.ino === stats.ino) {
    if (cached.fold.rejected) {
      // Rejection is final for the bytes it saw; any change rebuilds.
      if (sameObservedFile(cached, stats)) return { entry: { ...cached, summaryFold: cached.fold }, summaryFold: cached.fold, changed: false };
    } else if (await checkpointStillValid(file, stats, cached)) {
      const fold = cloneFold(cached.fold);
      const folded = await foldFileLines(file, fold, cached.offset, stats.size, chunkBuffer());
      const summaryFold = withPendingLine(fold, folded.pending);
      if (folded.offset === cached.offset && sameObservedFile(cached, stats)) {
        return { entry: { ...cached, summaryFold }, summaryFold, changed: false };
      }
      const entry = await checkpointEntry(file, stats, fold, folded.offset);
      return { entry: { ...entry, summaryFold }, summaryFold, changed: true };
    }
  }
  const fold = createEmptyFold();
  const folded = await foldFileLines(file, fold, 0, stats.size, chunkBuffer());
  const summaryFold = withPendingLine(fold, folded.pending);
  // Rejection stops the fold early; record the observed size so an unchanged
  // rejected file is answered without being re-read.
  const offset = fold.rejected ? Math.max(stats.size, folded.offset) : folded.offset;
  const entry = await checkpointEntry(file, stats, fold, offset);
  return { entry: { ...entry, summaryFold }, summaryFold, changed: true };
}

/** Whether the bytes folded into `cached` are still exactly the file's bytes before its offset. */
async function checkpointStillValid(file: FileHandle, stats: Stats, cached: SessionSummaryEntry): Promise<boolean> {
  if (stats.size < cached.offset) return false;
  // Same size but a new mtime means an in-place rewrite, not an append.
  if (stats.size === cached.size && stats.mtimeMs !== cached.mtimeMs) return false;
  if (await hashRange(file, 0, Math.min(CHECKPOINT_WINDOW_BYTES, cached.offset)) !== cached.headHash) return false;
  const tailStart = Math.max(0, cached.offset - CHECKPOINT_WINDOW_BYTES);
  return await hashRange(file, tailStart, cached.offset - tailStart) === cached.tailHash;
}

async function checkpointEntry(file: FileHandle, stats: Stats, fold: SummaryFoldState, offset: number): Promise<SessionSummaryEntry> {
  const tailStart = Math.max(0, offset - CHECKPOINT_WINDOW_BYTES);
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    offset,
    headHash: await hashRange(file, 0, Math.min(CHECKPOINT_WINDOW_BYTES, offset)),
    tailHash: await hashRange(file, tailStart, offset - tailStart),
    fold,
  };
}

async function hashRange(file: FileHandle, start: number, length: number): Promise<string> {
  const hash = createHash("sha256");
  if (length > 0) {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await file.read(buffer, 0, length, start);
    hash.update(buffer.subarray(0, bytesRead));
  }
  return hash.digest("hex");
}

/** The listing fold: the checkpointed fold plus an unterminated trailing line, if any. */
function withPendingLine(fold: SummaryFoldState, pending: Buffer | undefined): SummaryFoldState {
  if (pending === undefined || fold.rejected) return fold;
  const summaryFold = cloneFold(fold);
  processLineBytes(pending, 0, pending.length, summaryFold);
  return summaryFold;
}

/**
 * Fold every complete line in `[start, end)` of an open session file into
 * `fold`. Returns the offset just past the last complete line folded, and the
 * bytes of an unterminated trailing line (not folded; see withPendingLine).
 */
async function foldFileLines(file: FileHandle, fold: SummaryFoldState, start: number, end: number, chunkBuffer: Buffer): Promise<{ offset: number; pending: Buffer | undefined }> {
  let position = start;
  let committed = start;
  let pendingChunks: Buffer[] = [];
  while (position < end) {
    const { bytesRead } = await file.read(chunkBuffer, 0, Math.min(chunkBuffer.length, end - position), position);
    if (bytesRead === 0) break;
    const data = chunkBuffer.subarray(0, bytesRead);
    let lineStart = 0;
    let newlineAt = data.indexOf(NEWLINE);
    while (newlineAt !== -1) {
      if (pendingChunks.length > 0) {
        // A line longer than one chunk: join the saved pieces and finish it.
        pendingChunks.push(Buffer.from(data.subarray(lineStart, newlineAt)));
        const whole = Buffer.concat(pendingChunks);
        pendingChunks = [];
        processLineBytes(whole, 0, whole.length, fold);
      } else {
        processLineBytes(data, lineStart, newlineAt, fold);
      }
      committed = position + newlineAt + 1;
      if (fold.rejected) return { offset: committed, pending: undefined };
      lineStart = newlineAt + 1;
      newlineAt = data.indexOf(NEWLINE, lineStart);
    }
    if (lineStart < bytesRead) pendingChunks.push(Buffer.from(data.subarray(lineStart)));
    position += bytesRead;
  }
  return { offset: committed, pending: pendingChunks.length > 0 ? Buffer.concat(pendingChunks) : undefined };
}

/** Index file for one session directory: readable name plus a hash, since custom session dirs may share basenames. */
function summaryIndexPath(indexDir: string, sessionDir: string): string {
  const digest = createHash("sha256").update(sessionDir).digest("hex").slice(0, 16);
  return join(indexDir, `${basename(sessionDir) || "sessions"}-${digest}.json`);
}

function persistedEntry(entry: SessionSummaryEntry): PersistedSessionSummary {
  return {
    dev: entry.dev,
    ino: entry.ino,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    offset: entry.offset,
    headHash: entry.headHash,
    tailHash: entry.tailHash,
    fold: entry.fold,
  };
}

async function readSummaryIndex(indexPath: string, sessionDir: string): Promise<Map<string, SessionSummaryEntry>> {
  const entries = new Map<string, SessionSummaryEntry>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    return entries;
  }
  if (!isRecord(parsed) || parsed["version"] !== SUMMARY_INDEX_VERSION || parsed["sessionDir"] !== sessionDir || !isRecord(parsed["files"])) return entries;
  for (const [fileName, value] of Object.entries(parsed["files"])) {
    const entry = parsePersistedEntry(value);
    if (entry !== undefined && fileName.endsWith(".jsonl") && basename(fileName) === fileName) entries.set(fileName, entry);
  }
  return entries;
}

function parsePersistedEntry(value: unknown): SessionSummaryEntry | undefined {
  if (!isRecord(value)) return undefined;
  const { dev, ino, size, mtimeMs, offset, headHash, tailHash, fold } = value;
  if (!isFiniteNumber(dev) || !isFiniteNumber(ino) || !isFiniteNumber(size) || !isFiniteNumber(mtimeMs) || !isFiniteNumber(offset)) return undefined;
  if (typeof headHash !== "string" || typeof tailHash !== "string" || !isRecord(fold)) return undefined;
  const { header, rejected, messageCount, firstMessageText, name } = fold;
  if (header !== undefined && !isRecord(header)) return undefined;
  if (typeof rejected !== "boolean" || typeof messageCount !== "number") return undefined;
  if (firstMessageText !== undefined && typeof firstMessageText !== "string") return undefined;
  if (name !== undefined && typeof name !== "string") return undefined;
  return {
    dev,
    ino,
    size,
    mtimeMs,
    offset,
    headHash,
    tailHash,
    fold: { header, rejected, messageCount, firstMessageText, name },
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

async function writeSummaryIndex(indexPath: string, index: SummaryIndexFile): Promise<void> {
  await mkdir(dirname(indexPath), { recursive: true });
  const tempPath = `${indexPath}.${process.pid.toString()}-${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(index), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(tempPath, indexPath);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

/** The listing entry for a fold, or undefined when the file is not a usable session. */
function buildSummaryFromFold(fold: SummaryFoldState, filePath: string, mtime: Date): PiSessionListEntry | undefined {
  if (fold.rejected || fold.header === undefined) return undefined;
  const id = fold.header["id"];
  // The SDK would list a header without a usable id; downstream lookups then
  // call `.startsWith` on it and crash. Skip such files instead.
  if (typeof id !== "string" || id === "") return undefined;

  const headerCwd = fold.header["cwd"];
  const parentSessionPath = fold.header["parentSession"];
  const headerTimestamp = fold.header["timestamp"];
  return {
    path: filePath,
    id,
    cwd: typeof headerCwd === "string" ? headerCwd : "",
    created: typeof headerTimestamp === "string" || typeof headerTimestamp === "number" ? new Date(headerTimestamp) : new Date(Number.NaN),
    modified: mtime,
    messageCount: fold.messageCount,
    firstMessage: fold.firstMessageText ?? "(no messages)",
    // Never built: see the listing contract above. Kept because SDK-built
    // entries (cleanup listing) still carry the field.
    allMessagesText: "",
    ...(fold.name === undefined ? {} : { name: fold.name }),
    ...(typeof parentSessionPath === "string" ? { parentSessionPath } : {}),
  };
}

/** Classify and fold one line, addressed as bytes inside `data`. */
function processLineBytes(data: Buffer, start: number, end: number, state: SummaryFoldState): void {
  // Readline parity: a CRLF file yields lines without their trailing `\r`.
  if (end > start && data[end - 1] === CARRIAGE_RETURN) end -= 1;

  if (state.header === undefined) {
    const outcome = classifyPreHeaderLine(data.toString("utf8", start, end));
    if (outcome === "skip") return;
    if (outcome === "reject") {
      state.rejected = true;
      return;
    }
    state.header = outcome;
    return;
  }

  const entryType = classifyLineType(data, start, end);
  if (entryType === "session_info") {
    const entry = tryParseEntry(data.toString("utf8", start, end));
    if (entry !== undefined) state.name = sessionInfoName(entry);
    return;
  }
  if (entryType === "message") {
    // A line still being written can be complete JSON only if its last
    // significant byte is `}`; treating anything else as malformed matches
    // the SDK, which skips unparseable lines. Ending in `}` counts the line
    // without validating its JSON — a torn final write adds a transient +1
    // that self-heals when the line completes (see messageCount's contract).
    if (!endsWithClosingBrace(data, start, end)) return;
    state.messageCount += 1;
    // The expensive part of a listing was parsing message bodies; decode and
    // parse only until the first user text message is known.
    if (state.firstMessageText !== undefined) return;
    const entry = tryParseEntry(data.toString("utf8", start, end));
    if (entry !== undefined) {
      const userText = firstUserMessageText(entry);
      if (userText !== undefined) state.firstMessageText = userText;
    }
    return;
  }
  if (entryType !== undefined) return;

  // Lines that do not start with the SDK-style `{"type":"..."}` prefix
  // (foreign writers, garbage) fall back to a parse so they are classified
  // exactly like the SDK would.
  const entry = tryParseEntry(data.toString("utf8", start, end));
  if (entry === undefined) return;
  if (entry["type"] === "session_info") state.name = sessionInfoName(entry);
  else if (entry["type"] === "message") {
    state.messageCount += 1;
    if (state.firstMessageText === undefined) {
      const userText = firstUserMessageText(entry);
      if (userText !== undefined) state.firstMessageText = userText;
    }
  }
}

/**
 * The entry type from a line's leading bytes, without decoding it. The type
 * bytes are compared directly against the known SDK entry types: decoding
 * them first would mask each byte's high bit — `Buffer.toString("ascii")`
 * turns bytes like `ed e5 f3 f3 e1 e7 e5` into "message" — fabricating
 * matches for corrupt input. Returns "other" when the line carries the
 * SDK-style prefix but not a known type (only message/session_info matter
 * for the summary, so such lines need no parse), or undefined when the line
 * does not carry the prefix (or the type is unreasonably long), leaving
 * classification to the parse fallback.
 */
function classifyLineType(data: Buffer, start: number, end: number): "message" | "session_info" | "other" | undefined {
  const prefixLength = ENTRY_TYPE_PREFIX.length;
  if (end - start < prefixLength + 1) return undefined;
  for (let i = 0; i < prefixLength; i += 1) {
    if (data[start + i] !== ENTRY_TYPE_PREFIX[i]) return undefined;
  }
  const searchLimit = Math.min(end, start + prefixLength + MAX_CLASSIFIED_TYPE_LENGTH);
  const closeAt = data.indexOf(TYPE_QUOTE, start + prefixLength);
  if (closeAt === -1 || closeAt > searchLimit) return undefined;
  if (sameBytes(data, start + prefixLength, closeAt, MESSAGE_TYPE_BYTES)) return "message";
  if (sameBytes(data, start + prefixLength, closeAt, SESSION_INFO_TYPE_BYTES)) return "session_info";
  return "other";
}

/** Whether `data[start, end)` holds exactly `expected`'s bytes. */
function sameBytes(data: Buffer, start: number, end: number, expected: Buffer): boolean {
  if (end - start !== expected.length) return false;
  return expected.compare(data, start, end) === 0;
}

/**
 * Whether the line's last significant byte is `}`, skipping trailing spaces,
 * tabs, and carriage returns: JSON.parse (and therefore the SDK) tolerates
 * that whitespace, so valid message lines with it still count.
 */
function endsWithClosingBrace(data: Buffer, start: number, end: number): boolean {
  let last = end;
  while (last > start) {
    const byte = data[last - 1];
    if (byte !== SPACE && byte !== TAB && byte !== CARRIAGE_RETURN) break;
    last -= 1;
  }
  return last > start && data[last - 1] === CLOSING_BRACE;
}

/**
 * First parseable entry of a session file must be its session header —
 * exactly the SDK's rule: unparseable lines are skipped until one parses, and
 * a parseable non-session entry disqualifies the file.
 */
function classifyPreHeaderLine(line: string): Record<string, unknown> | "skip" | "reject" {
  const entry = tryParseEntry(line);
  if (entry === undefined) return "skip";
  if (entry["type"] !== "session") return "reject";
  return entry;
}

/** The SDK's name rule: latest `session_info` wins, and empty/missing names clear. */
function sessionInfoName(entry: Record<string, unknown>): string | undefined {
  const value = entry["name"];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The first user message with non-empty text content, mirroring the SDK's
 * `firstMessage` extraction (role/content shape checks and text-block join).
 */
function firstUserMessageText(entry: Record<string, unknown>): string | undefined {
  const message = entry["message"];
  if (!isRecord(message)) return undefined;
  if (message["role"] !== "user" || !("content" in message)) return undefined;
  const text = extractTextContent(message["content"]);
  return text === "" ? undefined : text;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const block of content) {
    if (!isRecord(block) || block["type"] !== "text") continue;
    const text = block["text"];
    if (typeof text === "string") texts.push(text);
  }
  return texts.join(" ");
}

async function listSessionFilesInDir(sessionDir: string): Promise<string[]> {
  let fileNames: string[];
  try {
    fileNames = await readdir(sessionDir);
  } catch {
    // Matches the SDK listing behavior: an unreadable directory lists nothing.
    return [];
  }
  return fileNames.filter((name) => name.endsWith(".jsonl")).map((name) => join(sessionDir, name));
}

function sortedSessionSummaries(summaries: readonly (PiSessionListEntry | undefined)[]): PiSessionListEntry[] {
  const sessions = summaries.filter((summary): summary is PiSessionListEntry => summary !== undefined);
  sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return sessions;
}

async function scanSessionFilesWithBoundedConcurrency(
  files: readonly string[],
  chunkBytes: number,
  scan: (file: string, chunkBuffer: () => Buffer) => Promise<PiSessionListEntry | undefined>,
): Promise<(PiSessionListEntry | undefined)[]> {
  const results: (PiSessionListEntry | undefined)[] = Array.from({ length: files.length }, () => undefined);
  let nextIndex = 0;
  const workerCount = Math.min(MAX_CONCURRENT_SESSION_SUMMARY_SCANS, files.length);
  const workers = Array.from({ length: workerCount }, async () => {
    // One reusable read buffer per worker, allocated on first use: warm
    // listings answer every file from the memo's stat-only fast path and
    // must not pay a chunk-sized allocation per worker for reads that
    // never happen.
    let chunkBuffer: Buffer | undefined;
    const readBuffer = (): Buffer => (chunkBuffer ??= Buffer.allocUnsafe(chunkBytes));
    for (;;) {
      const index = nextIndex++;
      const file = files[index];
      if (file === undefined) return;
      results[index] = await scan(file, readBuffer).catch(() => undefined);
    }
  });
  await Promise.all(workers);
  return results;
}
