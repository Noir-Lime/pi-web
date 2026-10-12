// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import * as sessionPaths from "../sessionPaths";
import { agentChildOffsets, agentSessionGroups, SessionList, sessionRowsForCurrentTree, visibleAgentSessionRows } from "./SessionList";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id, path: `/sessions/${id}.jsonl`, cwd: "/workspace",
    created: "2026-06-09T00:00:00.000Z", modified: "2026-06-09T00:00:00.000Z",
    messageCount: 1, firstMessage: id, persisted: true, ...overrides,
  };
}

function child(id: string, parent: SessionInfo, agentSubsession?: boolean): SessionInfo {
  return session(id, { parentSessionPath: parent.path, ...(agentSubsession === undefined ? {} : { agentSubsession }) });
}

async function settle(list: SessionList): Promise<void> {
  await list.updateComplete;
  await list.updateComplete;
}

async function mount(sessions: SessionInfo[], selected?: SessionInfo): Promise<SessionList> {
  const list = new SessionList();
  list.sessions = sessions;
  if (selected !== undefined) list.selected = selected;
  list.collapsible = true;
  document.body.append(list);
  await settle(list);
  return list;
}

function row(list: SessionList, id: string): HTMLElement | null {
  return list.shadowRoot?.querySelector<HTMLElement>(`.action-row[title="/sessions/${id}.jsonl"]`) ?? null;
}

function button(root: ParentNode | null, selector: string): HTMLButtonElement {
  const result = root?.querySelector<HTMLButtonElement>(selector);
  if (!result) throw new Error(`Missing button: ${selector}`);
  return result;
}

function agentToggle(list: SessionList, id: string): HTMLButtonElement {
  const toggle = row(list, id)?.nextElementSibling;
  if (!(toggle instanceof HTMLButtonElement) || !toggle.matches(".agent-subsession-toggle")) {
    throw new Error(`Missing hanging agent toggle for ${id}`);
  }
  return toggle;
}

function toolbarButton(list: SessionList, text: string): HTMLButtonElement {
  const result = Array.from(list.shadowRoot?.querySelectorAll<HTMLButtonElement>(".selection-toolbar button") ?? [])
    .find((item) => item.textContent.trim() === text);
  if (!result) throw new Error(`Missing toolbar button: ${text}`);
  return result;
}

describe("conservative agent child projection", () => {
  it("orders agent children before user/unknown siblings while preserving order within groups and roots", () => {
    const parent = session("parent");
    const user = child("user", parent, false);
    const firstAgent = child("first-agent", parent, true);
    const unknown = child("unknown", parent);
    const secondAgent = child("second-agent", parent, true);
    const nestedUser = child("nested-user", firstAgent);
    const nestedAgent = child("nested-agent", firstAgent, true);
    const other = session("other");
    const rows = sessionRowsForCurrentTree([other, parent, user, firstAgent, unknown, secondAgent, nestedUser, nestedAgent]);
    expect(rows.map(({ session: item }) => item.id)).toEqual([
      "other", "parent", "first-agent", "nested-agent", "nested-user", "second-agent", "user", "unknown",
    ]);
    expect(visibleAgentSessionRows(rows, new Set()).map(({ session: item }) => item.id)).toEqual([
      "other", "parent", "nested-user", "user", "unknown",
    ]);
  });

  it("counts only verified direct children and preserves user/unknown descendants and orphans", () => {
    const parent = session("parent");
    const agent = child("agent", parent, true);
    const nestedAgent = child("nested-agent", agent, true);
    const user = child("user", agent, false);
    const unknown = child("unknown", nestedAgent);
    const userAgent = child("user-agent", user, true);
    const orphan = session("orphan", { parentSessionPath: "/missing.jsonl", agentSubsession: true });
    const rows = sessionRowsForCurrentTree([parent, agent, nestedAgent, user, unknown, userAgent, orphan]);
    const groups = agentSessionGroups(rows);
    expect([...groups.countByParentId]).toEqual([["parent", 1], ["agent", 1], ["user", 1]]);
    expect(agentChildOffsets(rows, groups)).toEqual(new Map([["agent", 12], ["nested-agent", 24], ["user-agent", 12]]));
    const visible = (expanded: string[]) => visibleAgentSessionRows(rows, new Set(expanded), groups).map((item) => item.session.id);
    expect(visible([])).toEqual(["parent", "unknown", "user", "orphan"]);
    expect(visible(["user"])).toEqual(["parent", "unknown", "user", "user-agent", "orphan"]);
    expect(visible(["parent"])).toEqual(["parent", "agent", "unknown", "user", "orphan"]);
    expect(visible(["parent", "agent"])).toEqual(["parent", "agent", "nested-agent", "unknown", "user", "orphan"]);
  });

  it("insets sibling agent cards equally without narrowing user rows or other parents", () => {
    const parent = session("parent");
    const first = child("first", parent, true);
    const last = child("last", parent, true);
    const other = session("other");
    const otherChild = child("other-child", other, true);
    const rows = sessionRowsForCurrentTree([parent, first, last, child("user", parent), other, otherChild]);
    const groups = agentSessionGroups(rows);
    const visible = visibleAgentSessionRows(rows, new Set(["parent", "other"]), groups);
    expect(agentChildOffsets(visible, groups)).toEqual(new Map([["first", 12], ["last", 12], ["other-child", 12]]));
    expect(agentChildOffsets(visibleAgentSessionRows(rows, new Set(), groups), groups).size).toBe(0);
  });

  it("matches normalized parent paths and does not group missing or unverified parents", () => {
    const parent = session("parent", { path: "/sessions/parent.jsonl/" });
    const rows = sessionRowsForCurrentTree([
      parent,
      session("agent", { parentSessionPath: "/sessions/parent.jsonl", agentSubsession: true }),
      child("unknown", parent),
    ]);
    expect(visibleAgentSessionRows(rows, new Set()).map((item) => item.session.id)).toEqual(["parent", "unknown"]);
  });
});

describe("SessionList agent subsession controls", () => {
  it("places expanded agent children immediately below the chip before user children", async () => {
    const parent = session("parent");
    const user = child("user", parent);
    const agent = child("agent", parent, true);
    const list = await mount([parent, user, agent]);
    const toggle = agentToggle(list, "parent");
    expect(toggle.nextElementSibling).toBe(row(list, "user"));
    toggle.click();
    await settle(list);
    expect(toggle.nextElementSibling).toBe(row(list, "agent"));
    expect(row(list, "agent")?.nextElementSibling).toBe(row(list, "user"));
  });

  it("offers independent direct-parent toggles, including beneath hidden agent ancestors", async () => {
    const parent = session("parent");
    const agent = child("agent", parent, true);
    const nested = child("nested", agent, true);
    const user = child("user", agent);
    const userAgent = child("user-agent", user, true);
    const other = session("other");
    const otherAgent = child("other-agent", other, true);
    const list = await mount([parent, agent, nested, user, userAgent, other, otherAgent]);
    expect(row(list, "agent")).toBeNull();
    expect(row(list, "user")).not.toBeNull();
    expect(list.shadowRoot?.querySelector("h2 .section-count")?.textContent).toBe("7");
    const toggle = agentToggle(list, "parent");
    expect(row(list, "parent")?.querySelector(".agent-subsession-toggle")).toBeNull();
    expect(toggle.parentElement).toBe(row(list, "parent")?.parentElement);
    expect(toggle.textContent).toContain("Agent subsessions (1)");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const select = vi.fn();
    list.onSelect = select;
    toggle.click();
    await settle(list);
    expect(select).not.toHaveBeenCalled();
    expect(row(list, "agent")?.classList.contains("linked-agent-child")).toBe(true);
    expect(row(list, "agent")?.style.getPropertyValue("--agent-offset")).toBe("12px");
    expect(row(list, "user")?.classList.contains("linked-agent-child")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(row(list, "nested")).toBeNull();
    expect(row(list, "other-agent")).toBeNull();
    agentToggle(list, "user").click();
    await settle(list);
    expect(row(list, "user-agent")).not.toBeNull();
    agentToggle(list, "parent").click();
    await settle(list);
    expect(row(list, "agent")).toBeNull();
    expect(row(list, "user-agent")).not.toBeNull();
  });

  it("Select visible excludes collapsed children while tree and descendant counts include them", async () => {
    const parent = session("parent");
    const agent = child("agent", parent, true);
    const user = child("user", agent);
    const list = await mount([parent, agent, user]);
    button(list.shadowRoot, "h2 .bulk-select-entry").click();
    await settle(list);
    toolbarButton(list, "Select visible").click();
    await settle(list);
    expect(list.shadowRoot?.querySelectorAll(".session-checkbox:checked")).toHaveLength(2);
    expect(toolbarButton(list, "Clear selected (2)")).toBeDefined();
    agentToggle(list, "parent").click();
    await settle(list);
    expect(row(list, "agent")?.querySelector<HTMLInputElement>("input")?.checked).toBe(false);
    button(row(list, "parent"), ".action-menu-toggle").click();
    await settle(list);
    expect(row(list, "parent")?.textContent).toContain("Archive with descendants (2)");
  });

  it("reveals a selected nested agent on navigation but not same-id refresh churn", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const parent = session("parent");
    const agent = child("agent", parent, true);
    const nested = child("nested", agent, true);
    const list = await mount([parent, agent, nested], nested);
    expect(row(list, "nested")?.classList.contains("selected")).toBe(true);
    expect(scroll).toHaveBeenCalledOnce();
    agentToggle(list, "parent").click();
    await settle(list);
    scroll.mockClear();
    const refreshed = { ...nested, messageCount: 2 };
    list.sessions = [parent, agent, refreshed];
    list.selected = refreshed;
    await settle(list);
    expect(row(list, "nested")).toBeNull();
    expect(scroll).not.toHaveBeenCalled();
    list.selected = parent;
    await settle(list);
    list.selected = nested;
    await settle(list);
    expect(row(list, "nested")).not.toBeNull();
  });

  it("keeps archived child controls reachable and selects only visible archived rows", async () => {
    const parent = session("parent", { archived: true });
    const agent = session("agent", { parentSessionPath: parent.path, agentSubsession: true, archived: true });
    const other = session("other", { archived: true });
    const list = await mount([parent, agent, other]);
    button(list.shadowRoot, ".subheading .section-toggle").click();
    await settle(list);
    expect(list.shadowRoot?.querySelector(".subheading .section-count")?.textContent).toBe("3");
    expect(row(list, "agent")).toBeNull();
    button(list.shadowRoot, ".subheading .bulk-select-entry").click();
    await settle(list);
    toolbarButton(list, "Select visible").click();
    await settle(list);
    expect(list.shadowRoot?.querySelectorAll(".session-checkbox:checked")).toHaveLength(2);
    list.selected = agent;
    await settle(list);
    expect(row(list, "agent")).not.toBeNull();
  });

  it("renders unavailable-parent agents and restores conservative collapsing when a parent arrives", async () => {
    const parent = session("parent");
    const agent = child("agent", parent, true);
    const list = await mount([agent]);
    expect(row(list, "agent")?.querySelector(".orphan-marker")).not.toBeNull();
    list.sessions = [parent, agent];
    await settle(list);
    expect(row(list, "agent")).toBeNull();
    expect(agentToggle(list, "parent")).toBeDefined();
    list.sessions = [agent];
    await settle(list);
    expect(row(list, "agent")).not.toBeNull();
  });

  it("keeps native toggle focus, row keyboard activation, and cached hierarchy work", async () => {
    const parent = session("parent");
    const agent = child("agent", parent, true);
    const user = child("user", agent);
    const list = await mount([parent, agent, user]);
    const normalize = vi.spyOn(sessionPaths, "normalizeSessionPath");
    const parentRow = row(list, "parent");
    const select = vi.fn();
    list.onSelect = select;
    parentRow?.focus();
    parentRow?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    expect(select).toHaveBeenCalledWith(parent);
    select.mockClear();
    const toggle = agentToggle(list, "parent");
    toggle.focus();
    toggle.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    expect(select).not.toHaveBeenCalled();
    // happy-dom does not synthesize the browser's keyboard activation click.
    toggle.click();
    await settle(list);
    expect(list.shadowRoot?.activeElement).toBe(toggle);
    list.statuses = {};
    list.activities = {};
    list.sending = { agent: true };
    await settle(list);
    expect(normalize).not.toHaveBeenCalled();
    expect(row(list, "agent")).not.toBeNull();
  });
});
