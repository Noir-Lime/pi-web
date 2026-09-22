import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../types.js";
import { ProjectStore, projectStorePath } from "./projectStore.js";

describe("ProjectStore.add", () => {
  let directory: string;
  let filePath: string;
  let store: ProjectStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "pi-web-project-store-"));
    filePath = join(directory, "projects.json");
    store = new ProjectStore(filePath);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("awaits validation of the exact prospective project before persisting it", async () => {
    const beforeRegister = vi.fn(async (project: Project) => {
      expect(project).toMatchObject({ name: "Demo", path: "/workspace/demo" });
      expect(project.id).toEqual(expect.any(String));
      expect(await store.list()).toEqual([]);
      await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    const project = await store.add({ name: " Demo ", path: "/workspace/demo" }, beforeRegister);

    expect(beforeRegister).toHaveBeenCalledExactlyOnceWith(project);
    expect(beforeRegister.mock.calls[0]?.[0]).toBe(project);
    expect(await new ProjectStore(filePath).list()).toEqual([project]);
  });

  it("does not register or write when validation fails", async () => {
    const failure = new Error("Provider unavailable");
    await expect(store.add({ path: "/workspace/demo" }, () => Promise.reject(failure))).rejects.toBe(failure);

    expect(await store.list()).toEqual([]);
    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("validates existing projects without rewriting or removing them on success or failure", async () => {
    const existing = await store.add({ path: "/workspace/demo" });
    const contents = await readFile(filePath, "utf8");
    const metadata = await stat(filePath);
    const beforeRegister = vi.fn<(project: Project) => Promise<void>>().mockResolvedValue(undefined);

    expect(await store.add({ name: "Ignored", path: existing.path }, beforeRegister)).toEqual(existing);
    expect(beforeRegister).toHaveBeenCalledExactlyOnceWith(existing);

    const failure = new Error("Provider unavailable");
    const rejectingHook = vi.fn<(project: Project) => Promise<void>>().mockRejectedValue(failure);
    await expect(store.add({ path: existing.path }, rejectingHook)).rejects.toBe(failure);
    expect(rejectingHook).toHaveBeenCalledExactlyOnceWith(existing);
    expect(await store.list()).toEqual([existing]);
    expect(await readFile(filePath, "utf8")).toBe(contents);
    expect((await stat(filePath)).mtimeMs).toBe(metadata.mtimeMs);
  });
});

describe("projectStorePath", () => {
  it("uses PI_WEB_DATA_DIR by default", () => {
    expect(projectStorePath({ PI_WEB_DATA_DIR: "demo-data" }, "/tmp/pi-web")).toBe(resolve("/tmp/pi-web", "demo-data", "projects.json"));
  });

  it("uses PI_WEB_PROJECTS_FILE when configured", () => {
    expect(projectStorePath({ PI_WEB_PROJECTS_FILE: "demo/projects.json" }, "/tmp/pi-web")).toBe(resolve("/tmp/pi-web", "demo/projects.json"));
  });
});
