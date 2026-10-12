import type { PiWebPlugin, PluginRuntimeContext } from "@jmfederico/pi-web/plugin-api";

type WorktreePromptContext = Pick<PluginRuntimeContext, "state" | "prompt" | "focusPrompt">;

function canPrepareWorktreePrompt({ state, prompt }: Pick<WorktreePromptContext, "state" | "prompt">): boolean {
  const session = state.selectedSession;
  return state.mainView === "chat"
    && state.selectedWorkspace !== undefined
    && session !== undefined
    && !session.archived
    && !session.pending
    && prompt.getText() === "";
}

const plugin = {
  apiVersion: 4,
  name: "Workflows",
  activate: () => ({
    contributions: {
      actions: [{
        id: "worktree.create",
        title: "Create Worktree",
        description: "Prepare /worktree; describe its purpose and/or base branch before sending",
        group: "Workflows",
        enabled: canPrepareWorktreePrompt,
        disabledReason: () => "Select an active conversation in Chat with an empty prompt first.",
        run: (context: WorktreePromptContext) => {
          if (!canPrepareWorktreePrompt(context)) return;
          context.focusPrompt();
          context.prompt.insertText("/worktree ");
        },
      }],
    },
  }),
} satisfies PiWebPlugin;

export default plugin;
