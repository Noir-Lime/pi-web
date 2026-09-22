import type { ProjectService } from "./projectService.js";
import type { Project, WorkspaceProviderAuthorityResolution } from "../../shared/apiTypes.js";

interface ProjectLifecycleDependencies {
  projects: Pick<ProjectService, "list" | "add" | "close">;
  workspaces: { resolve(project: Project): Promise<WorkspaceProviderAuthorityResolution> };
  /** False when startup health or safe-start filtering may hide providers. */
  workspaceAuthorityAvailable(): boolean;
  /** Returns a rollback for transient eligibility if a subsequent registration write fails. */
  reconcileUnreadWorkspaces(cwds: Iterable<string>): Promise<() => void>;
  allowUnreadWorkspaces(cwds: Iterable<string>): void;
  onChanged(): void;
}

/**
 * Sessiond owns project mutations together with unread eligibility. Serializing
 * admission and removal prevents a rapid re-add from recovering old unread state.
 * Project/session files are never removed here.
 */
export class ProjectLifecycleService {
  private queue: Promise<unknown> = Promise.resolve();
  private refreshing: Promise<void> | undefined;
  private stopping = false;

  constructor(private readonly dependencies: ProjectLifecycleDependencies) {}

  /** Also repairs catalogs written before project removal cleared unread state. */
  refresh(): Promise<void> {
    if (this.refreshing !== undefined) return this.refreshing;
    const refresh = this.serialized(() => this.refreshCurrentWorkspaces());
    this.refreshing = refresh;
    void refresh.finally(() => {
      if (this.refreshing === refresh) this.refreshing = undefined;
    }).catch(() => undefined);
    return refresh;
  }

  add(input: Parameters<ProjectService["add"]>[0]): Promise<Project> {
    return this.serialized(async () => {
      // Prune legacy orphan state BEFORE admitting its cwd again.
      const currentCwds = await this.currentWorkspaceCwds();
      await this.dependencies.reconcileUnreadWorkspaces(currentCwds);
      let nextCwds = currentCwds;
      const project = await this.dependencies.projects.add(input, async (candidate) => {
        // Validate the prospective provider before registration is written.
        nextCwds = [...currentCwds, ...await this.workspaceCwds([candidate])];
      });
      // Additive eligibility has no durable state and cannot leave a committed
      // registration half-added because of an unrelated unread flush failure.
      this.dependencies.allowUnreadWorkspaces(nextCwds);
      this.dependencies.onChanged();
      return project;
    });
  }

  close(id: string): Promise<void> {
    return this.serialized(async () => {
      const projects = await this.dependencies.projects.list();
      if (!projects.some((project) => project.id === id)) throw new Error("Project not found");
      const retainedCwds = await this.workspaceCwds(projects.filter((project) => project.id !== id));
      // Persist cleanup before removing the registration. On failure the project
      // remains registered and close can be retried; never report partial cleanup
      // as a successful close. Shared workspace paths remain eligible.
      const restoreEligibility = await this.dependencies.reconcileUnreadWorkspaces(retainedCwds);
      try {
        await this.dependencies.projects.close(id);
      } catch (error) {
        restoreEligibility();
        throw error;
      }
      this.dependencies.onChanged();
    });
  }

  /** Drain admitted mutations before the daemon disposes sessions and flushes unread. */
  async closeAll(): Promise<void> {
    this.stopping = true;
    await this.queue;
  }

  private async refreshCurrentWorkspaces(): Promise<void> {
    await this.dependencies.reconcileUnreadWorkspaces(await this.currentWorkspaceCwds());
    this.dependencies.onChanged();
  }

  private async currentWorkspaceCwds(): Promise<string[]> {
    return this.workspaceCwds(await this.dependencies.projects.list());
  }

  private async workspaceCwds(projects: readonly Project[]): Promise<string[]> {
    if (projects.length > 0 && !this.dependencies.workspaceAuthorityAvailable()) {
      throw new Error("Cannot reconcile project unread state while workspace providers are unavailable or safe-start is active");
    }
    const resolutions = await Promise.all(projects.map((project) => this.dependencies.workspaces.resolve(project)));
    // Attribution's best-effort, cached listings are NOT deletion authority.
    // Even a fallback folder can hide worktrees after a provider probe failure.
    for (const resolution of resolutions) {
      if (resolution.status === "degraded" || resolution.diagnostics.length > 0) {
        throw new Error(`Cannot reconcile project unread state: workspace resolution incomplete for ${resolution.projectId}`);
      }
    }
    return resolutions.flatMap((resolution) => resolution.workspaces.map((workspace) => workspace.path));
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new Error("Project lifecycle is shutting down"));
    const result = this.queue.then(operation);
    // A failed operation is returned to its caller, but must not poison the queue.
    this.queue = result.catch(() => undefined);
    return result;
  }
}
