import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { PiSessionEventConnections } from "./piSessionEventConnections.js";
import { parseSubsessionBackgroundJobs, querySubsessionBackgroundJobs, renderSubsessionBackgroundJobs } from "./subsessionBackgroundJobs.js";

const snapshot = {
  version: 1 as const,
  observedAt: "2026-10-21T08:00:00.000Z",
  jobs: [{ id: "bg-1", kind: "background" as const, command: "printf 'hello\\n'\nmake check", logpath: "/tmp/job.log", pid: 123, startedAt: "2026-10-21T07:59:00.000Z" }],
};

describe("live child background jobs", () => {
  it("queries the extension-owned map on the concrete session bus without persisting or caching", () => {
    const bus = createEventBus();
    const connections = new PiSessionEventConnections();
    const session = {};
    connections.register(session, bus);
    let queries = 0;
    const unsubscribe = bus.on("bash-background:query-v1", (value: unknown) => {
      queries += 1;
      if (typeof value === "object" && value !== null && "requestId" in value) {
        bus.emit("bash-background:snapshot-v1", { requestId: value.requestId, snapshot });
      }
    });
    expect(querySubsessionBackgroundJobs((signal) => connections.connect(session, signal))).toEqual(snapshot);
    unsubscribe();
    expect(querySubsessionBackgroundJobs((signal) => connections.connect(session, signal))).toBeUndefined();
    expect(queries).toBe(1);
    connections.close(session);
  });

  it("keeps missing, malformed and wrong-request replies unknown, not empty", () => {
    const connections = new PiSessionEventConnections();
    const session = {};
    expect(querySubsessionBackgroundJobs((signal) => connections.connect(session, signal))).toBeUndefined();
    const bus = createEventBus();
    connections.register(session, bus);
    bus.on("bash-background:query-v1", () => { bus.emit("bash-background:snapshot-v1", { requestId: "not-this-query", snapshot }); });
    expect(querySubsessionBackgroundJobs((signal) => connections.connect(session, signal))).toBeUndefined();
    expect(parseSubsessionBackgroundJobs({ ...snapshot, jobs: [{ ...snapshot.jobs[0], pid: -1 }] })).toBeUndefined();
    expect(parseSubsessionBackgroundJobs({ ...snapshot, jobs: [] })).toEqual({ ...snapshot, jobs: [] });
    connections.close(session);
  });

  it("renders command provenance and explicit unknown/empty/truncation states", () => {
    expect(renderSubsessionBackgroundJobs(undefined, JSON.stringify)).toContain("unknown");
    expect(renderSubsessionBackgroundJobs({ ...snapshot, jobs: [] }, JSON.stringify)).toContain("none running");
    expect(renderSubsessionBackgroundJobs(snapshot, JSON.stringify)).toContain("make check");
    const first = snapshot.jobs[0];
    if (first === undefined) throw new Error("Missing job fixture");
    expect(renderSubsessionBackgroundJobs({ ...snapshot, jobs: [{ ...first, command: "x".repeat(400) }] }, JSON.stringify)).toContain("command truncated");
  });
});
