import type { PiWebPlugin, WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";

const plugin: PiWebPlugin = {
  apiVersion: 4,
  name: "Session Bridge Example",
  activate({ html }) {
    const results = new Map<string, string>();
    const pending = new Set<string>();
    const key = (context: WorkspacePanelContext) => `${context.machine.id}:${context.workspace.projectId}:${context.workspace.id}`;
    async function greet(context: WorkspacePanelContext, operation: "create" | "existing"): Promise<void> {
      const scope = key(context);
      if (pending.has(scope)) return;
      pending.add(scope);
      results.set(scope, "Waiting for companion receipt…");
      context.host.requestRender();
      try {
        if (!context.peer?.request) throw new Error("Package backend unavailable on the selected machine");
        const id = selectedSessionId(context);
        if (operation === "existing" && !id) throw new Error("Select an existing session first");
        const result = await context.peer.request(operation, operation === "existing" ? id ?? null : null);
        if (typeof result !== "object" || result === null || !("sessionId" in result) || !("message" in result)
          || typeof result["sessionId"] !== "string" || typeof result["message"] !== "string") throw new Error("Invalid backend receipt");
        results.set(scope, `${result["sessionId"]}: ${result["message"]}`);
      } catch (error) {
        results.set(scope, error instanceof Error ? error.message : String(error));
      } finally {
        pending.delete(scope);
        context.host.requestRender();
      }
    }
    return {
      contributions: {
        workspacePanels: [{
          id: "greeting",
          title: "Session Bridge",
          render(context) {
            const disabled = pending.has(key(context)) || !context.peer?.request;
            return html`<section class="viewer">
              <p>Send a greeting through this package's native Pi companion.</p>
              <button ?disabled=${disabled} @click=${() => { void greet(context, "create"); }}>Create session and greet</button>
              <button ?disabled=${disabled || !selectedSessionId(context)} @click=${() => { void greet(context, "existing"); }}>Greet selected session</button>
              <p aria-live="polite">${results.get(key(context)) ?? "Choose a new or selected hosted conversation."}</p>
            </section>`;
          },
        }],
      },
      dispose() { results.clear(); },
    };
  },
};
export default plugin;

function selectedSessionId(context: WorkspacePanelContext): string | undefined {
  const session = context.state?.selectedSession;
  return typeof session === "object" && session !== null && "id" in session && typeof session.id === "string"
    ? session.id : undefined;
}
