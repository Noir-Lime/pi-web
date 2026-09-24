import type { SessionRef } from "../../../shared/apiTypes";
import { resolveAppUrl } from "../appUrl";

type SessionLookup = SessionRef | string;

function sessionId(session: SessionLookup): string {
  return typeof session === "string" ? session : session.id;
}

function sessionCwd(session: SessionLookup): string | undefined {
  return typeof session === "string" ? undefined : session.cwd;
}

/**
 * Inline base64 length above which history pages return raster images as media
 * references instead (see server `projectBrowserMessageResponse`). About 48 KB
 * of image data: small images stay inline, screenshots load lazily.
 */
export const MAX_INLINE_MEDIA_BASE64_LENGTH = 65_536;

export function messagePath(session: SessionLookup, options?: { limit?: number; before?: number }, machineId = "local"): string {
  const params = new URLSearchParams();
  const cwd = sessionCwd(session);
  if (cwd !== undefined && cwd !== "") params.set("cwd", cwd);
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  if (options?.before !== undefined) params.set("before", String(options.before));
  params.set("maxInlineMedia", String(MAX_INLINE_MEDIA_BASE64_LENGTH));
  const query = params.toString();
  return `api/machines/${encodeURIComponent(machineId)}/sessions/${encodeURIComponent(sessionId(session))}/messages${query === "" ? "" : `?${query}`}`;
}

/**
 * Browser-ready URL for a lazily loaded history image. `messageIndex` is a
 * lookup hint only; the content-hash `mediaId` alone identifies the image.
 */
export function sessionMediaUrl(session: SessionLookup, mediaId: string, messageIndex: number, machineId = "local"): string {
  const params = new URLSearchParams();
  const cwd = sessionCwd(session);
  if (cwd !== undefined && cwd !== "") params.set("cwd", cwd);
  params.set("at", String(messageIndex));
  return resolveAppUrl(`api/machines/${encodeURIComponent(machineId)}/sessions/${encodeURIComponent(sessionId(session))}/media/${encodeURIComponent(mediaId)}?${params.toString()}`);
}

export function workspaceFileWriteUrl(projectId: string, workspaceId: string, path: string, options?: { createDirs?: boolean; overwrite?: boolean; machineId?: string }): string {
  const params = new URLSearchParams({ path });
  if (options?.createDirs === false) params.set("createDirs", "false");
  if (options?.overwrite === false) params.set("overwrite", "false");
  const prefix = `api/machines/${encodeURIComponent(options?.machineId ?? "local")}`;
  return resolveAppUrl(`${prefix}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file?${params.toString()}`);
}

export interface WorkspaceFilePreviewUrlOptions {
  modifiedAt?: string;
  machineId?: string;
  download?: boolean;
}

export function workspaceFilePreviewPath(projectId: string, workspaceId: string, path: string, options?: WorkspaceFilePreviewUrlOptions): string {
  const params = new URLSearchParams();
  params.set("path", path);
  if (options?.modifiedAt !== undefined) params.set("v", options.modifiedAt);
  if (options?.download === true) params.set("download", "1");
  const prefix = `api/machines/${encodeURIComponent(options?.machineId ?? "local")}`;
  return `${prefix}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file/preview?${params.toString()}`;
}

export function workspaceFilePreviewUrl(projectId: string, workspaceId: string, path: string, options?: WorkspaceFilePreviewUrlOptions): string {
  return resolveAppUrl(workspaceFilePreviewPath(projectId, workspaceId, path, options));
}
