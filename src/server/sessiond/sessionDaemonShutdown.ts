export interface SessionDaemonShutdownLogger {
  error(details: Record<string, unknown>, message: string): void;
}

export interface SessionDaemonShutdownDependencies {
  quiesceServer(): void | Promise<void>;
  serverPlugins: {
    beginShutdown(): void | Promise<void>;
    stop(): void | Promise<void>;
  };
  catalogRefresher: { dispose(): void | Promise<void> };
  auth: { dispose(): void | Promise<void> };
  sessions: { dispose(): void | Promise<void> };
  unreadStore: { flush(): void | Promise<void> };
  pluginBackends: { closeAll(): void | Promise<void> };
  workspaceProviders: { closeAll(): void | Promise<void> };
  workspaceRemovals: { closeAll(): void | Promise<void> };
  closeServer(): void | Promise<void>;
}

export interface SessionDaemonShutdownOptions {
  logger: SessionDaemonShutdownLogger;
  dependencies: SessionDaemonShutdownDependencies;
  onFailure?: () => void;
}

/** Quiesces ingress, disposes consumers, then tears down plugin providers and dependencies. */
export async function runSessionDaemonShutdown(options: SessionDaemonShutdownOptions): Promise<void> {
  const { dependencies } = options;
  const operations: readonly (readonly [string, () => void | Promise<void>])[] = [
    ["quiesce server", () => dependencies.quiesceServer()],
    ["dispose catalog refresher", () => dependencies.catalogRefresher.dispose()],
    // Keep plugin lifetimes and required capabilities available until every
    // admitted contribution callback and Terminal consumer has observed
    // cancellation and drained.
    ["close workspace removal work", () => dependencies.workspaceRemovals.closeAll()],
    ["close plugin backend work", () => dependencies.pluginBackends.closeAll()],
    ["close workspace provider work", () => dependencies.workspaceProviders.closeAll()],
    ["cancel server plugin lifetimes", () => dependencies.serverPlugins.beginShutdown()],
    // Plugin capability cleanup must finish while its host-owned sessions remain available.
    ["stop server plugins", () => dependencies.serverPlugins.stop()],
    ["dispose sessions", () => dependencies.sessions.dispose()],
    ["close server", () => dependencies.closeServer()],
    ["dispose auth", () => dependencies.auth.dispose()],
    ["flush session unread state", () => dependencies.unreadStore.flush()],
  ];

  for (const [operation, run] of operations) {
    try {
      await run();
    } catch (error) {
      options.onFailure?.();
      options.logger.error({ err: error, operation }, "session daemon shutdown operation failed");
    }
  }
}
