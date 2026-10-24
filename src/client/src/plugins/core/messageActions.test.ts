import { afterEach, describe, expect, it, vi } from "vitest";
import type { DisplayedMessageActionContext, DisplayedMessageActionContribution, MessageActionAvailabilityContextV5 as MessageActionAvailabilityContext } from "../../../../plugin-api";
import { availableDisplayedMessageActions, availableMessageActions } from "../messageActions";
import { createCoreMessageActions } from "./messageActions";

const input: MessageActionAvailabilityContext = {
  machine: { id: "local", name: "Local", kind: "local" },
  session: { id: "session", cwd: "/repo", archived: false, pending: false, busy: false },
  message: { entryId: "entry", role: "assistant", text: "Original text" },
};

function copyAction(writeText: (text: string) => Promise<boolean>): DisplayedMessageActionContribution {
  const action = createCoreMessageActions(writeText).find((action) => action.id === "message.copy");
  if (action?.target !== "display") throw new Error("Expected a display-targeted core Copy action");
  return action;
}

function invocation(role: "user" | "assistant" = "assistant"): DisplayedMessageActionContext {
  return {
    machine: input.machine,
    session: input.session,
    message: { role, text: "**Original**\n\nSecond  line" },
    navigate: vi.fn(),
    prompt: { insertText: vi.fn(), getText: () => "", getSelection: () => null },
    projects: { machineId: "local", listProjects: vi.fn(), suggestDirectories: vi.fn() },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("core question history actions", () => {
  it.each([
    { flags: {}, enabled: true },
    { flags: { busy: true }, enabled: false },
    { flags: { archived: true }, enabled: false },
    { flags: { pending: true }, enabled: false },
  ])("uses the existing history policy for questions ($flags)", ({ flags, enabled }) => {
    const actions = createCoreMessageActions().map((action) => ({
      ...action, binding: { registrationPluginId: "core", sourcePluginId: "core" },
    }));
    const session = { ...input.session, ...flags };
    expect(availableMessageActions(actions, {
      ...input, session, message: { entryId: "question-result", role: "tool", text: "", isQuestion: true },
    }).map(({ action, enabled }) => ({ id: action.id, enabled }))).toEqual([
      { id: "message.fork", enabled }, { id: "message.back", enabled },
    ]);
    expect(availableMessageActions(actions, {
      ...input, session, message: { entryId: "ordinary-tool-result", role: "tool", text: "Tool output" },
    })).toEqual([]);
  });
});

describe("core Edit message action", () => {
  const edit = () => {
    const action = createCoreMessageActions().find((candidate) => candidate.id === "message.edit");
    if (action === undefined || action.target === "display") throw new Error("Expected an entry-targeted core Edit action");
    return action;
  };
  const message = { entryId: "entry", role: "user" as const, text: "Hello", editable: true };

  it("is visible only for editable user messages and follows the history enablement policy", () => {
    const actions = [{ ...edit(), binding: { registrationPluginId: "core", sourcePluginId: "core" } }];
    const ids = (context: MessageActionAvailabilityContext) => availableMessageActions(actions, context).map(({ enabled }) => enabled);
    expect(ids({ ...input, message })).toEqual([true]);
    expect(ids({ ...input, message: { entryId: "entry", role: "user", text: "Hello" } })).toEqual([]);
    expect(ids({ ...input, message: { ...message, role: "assistant" } })).toEqual([]);
    for (const flags of [{ busy: true }, { archived: true }, { pending: true }]) {
      expect(ids({ ...input, session: { ...input.session, ...flags }, message })).toEqual([false]);
    }
  });

  it("opens the host editor, and fails explicitly when the host has no edit support", async () => {
    const open = vi.fn(() => Promise.resolve());
    const base = { ...invocation("user"), message, history: { fork: vi.fn(), goBack: vi.fn() } };
    await edit().run({ ...base, history: { ...base.history, edit: open } });
    expect(open).toHaveBeenCalledOnce();
    await expect(Promise.resolve().then(() => edit().run(base))).rejects.toThrow("does not support editing");
  });
});

describe("core display Copy action", () => {
  it.each([
    { state: "ready", flags: { busy: false, archived: false, pending: false } },
    { state: "busy", flags: { busy: true, archived: false, pending: false } },
    { state: "archived", flags: { busy: false, archived: true, pending: false } },
    { state: "pending", flags: { busy: false, archived: false, pending: true } },
    { state: "busy, archived and pending", flags: { busy: true, archived: true, pending: true } },
  ])("leaves Copy available for entryless user/assistant text while $state without weakening history policy", ({ flags }) => {
    const writeText = vi.fn<(text: string) => Promise<boolean>>();
    const actions = createCoreMessageActions(writeText).map((action) => ({
      ...action, binding: { registrationPluginId: "core", sourcePluginId: "core" },
    }));
    for (const role of ["user", "assistant"] as const) {
      const session = { ...input.session, ...flags };
      const displayInput = { machine: input.machine, session, message: { role, text: "Original text" } };
      const available = availableDisplayedMessageActions(actions, displayInput);
      expect(available).toHaveLength(1);
      expect(available[0]).toMatchObject({
        action: { id: "message.copy", title: "Copy message", target: "display" },
        enabled: true,
        ariaLabel: `Copy ${role} message`,
      });
      const history = availableMessageActions(actions, { ...input, session, message: { ...input.message, role } });
      expect(history.map(({ action, enabled }) => ({ id: action.id, enabled }))).toEqual([
        { id: "message.fork", enabled: !flags.busy && !flags.archived && !flags.pending },
        { id: "message.back", enabled: !flags.busy && !flags.archived && !flags.pending },
      ]);
    }
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each([
    { role: "user", text: "" },
    { role: "assistant", text: "" },
    { role: "tool", text: "Tool output" },
    { role: "system", text: "System message" },
    { role: "bash", text: "Command output" },
    { role: "skill", text: "Skill instructions" },
  ] as const)("does not offer Copy for $role with text '$text'", ({ role, text }) => {
    const writeText = vi.fn<(text: string) => Promise<boolean>>();
    const actions = createCoreMessageActions(writeText).map((action) => ({
      ...action, binding: { registrationPluginId: "core", sourcePluginId: "core" },
    }));
    expect(availableDisplayedMessageActions(actions, { ...input, message: { role, text } })).toEqual([]);
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each(["user", "assistant"] as const)("copies %s original text through the injected helper and returns success feedback without confirmation", async (role) => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    const writeText = vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true);
    const action = copyAction(writeText);
    const context = invocation(role);
    const feedback = await action.run(context);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("**Original**\n\nSecond  line");
    expect(confirm).not.toHaveBeenCalled();
    expect(context).not.toHaveProperty("history");
    expect(feedback).toMatchObject({ title: "Copied", ariaLabel: `Copied ${role} message` });
    expect(feedback).toHaveProperty("icon");
    expect(feedback).not.toMatchObject({ icon: action.icon });
  });

  it("fails visibly instead of returning success feedback when the clipboard helper reports failure", async () => {
    const writeText = vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(false);
    await expect(copyAction(writeText).run(invocation())).rejects.toThrow("Unable to copy message to the clipboard.");
    expect(writeText).toHaveBeenCalledExactlyOnceWith("**Original**\n\nSecond  line");
  });

  it("propagates a rejected clipboard write rather than disguising it as success", async () => {
    const failure = new Error("Clipboard denied");
    const writeText = vi.fn<(text: string) => Promise<boolean>>().mockRejectedValue(failure);
    await expect(copyAction(writeText).run(invocation())).rejects.toBe(failure);
    expect(writeText).toHaveBeenCalledOnce();
  });
});
