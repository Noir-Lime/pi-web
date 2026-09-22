import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectStore } from "../storage/projectStore.js";
import type { Project } from "../types.js";
import { ProjectService } from "./projectService.js";

describe("ProjectService.add", () => {
  let directory: string;
  let store: ProjectStore;
  let service: ProjectService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "pi-web-project-service-"));
    store = new ProjectStore(join(directory, "projects.json"));
    service = new ProjectService(store);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("forwards validation after creating and resolving the directory", async () => {
    const path = join(directory, "workspace");
    const beforeRegister = vi.fn(async (project: Project) => {
      expect(project.path).toBe(await realpath(path));
      expect(project.name).toBe("Demo");
      expect(await store.list()).toEqual([]);
    });

    const project = await service.add({ path: ` ${path} `, name: "Demo", create: true }, beforeRegister);

    expect(beforeRegister).toHaveBeenCalledExactlyOnceWith(project);
    expect(await store.list()).toEqual([project]);
  });

  it("propagates validation failure without registering the project", async () => {
    const failure = new Error("Provider unavailable");
    await expect(service.add({ path: directory }, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(await store.list()).toEqual([]);
  });

  it("rejects non-directory paths before invoking the hook", async () => {
    const path = join(directory, "file.txt");
    await writeFile(path, "not a directory");
    const beforeRegister = vi.fn<(project: Project) => Promise<void>>().mockResolvedValue(undefined);

    await expect(service.add({ path }, beforeRegister)).rejects.toThrow("Project path must be a directory");
    expect(beforeRegister).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([]);
  });
});
