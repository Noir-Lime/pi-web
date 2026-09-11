import { randomUUID } from "node:crypto";
import {
  PI_WEB_HOST_PI_SESSIONS_CAPABILITY,
  PI_WEB_HOST_PI_SESSION_EVENTS_CAPABILITY,
} from "@jmfederico/pi-web/server-plugin-api";
import type {
  PiWebHostPiSessionConnection,
  PiWebHostPiSessionsV1,
  PiWebHostPiSessionEventsV1,
  PiWebServerPlugin,
} from "@jmfederico/pi-web/server-plugin-api";

const plugin = {
  apiVersion: 3,
  name: "Session Bridge Example",
  requires: [PI_WEB_HOST_PI_SESSIONS_CAPABILITY, PI_WEB_HOST_PI_SESSION_EVENTS_CAPABILITY],
  activate() {
    let piSessions: PiWebHostPiSessionsV1;
    let sessionEvents: PiWebHostPiSessionEventsV1;
    return {
      start({ capabilities }) {
        piSessions = capabilities.resolve(PI_WEB_HOST_PI_SESSIONS_CAPABILITY);
        sessionEvents = capabilities.resolve(PI_WEB_HOST_PI_SESSION_EVENTS_CAPABILITY);
      },
      peer: {
        async request(context) {
          const selection = { projectId: context.project.id, workspaceId: context.workspace.id };
          context.signal.throwIfAborted();
          let sessionId: string;
          if (context.operation === "create") {
            ({ sessionId } = await piSessions.create(selection));
          } else if (context.operation === "existing" && typeof context.input === "string" && context.input.trim()) {
            sessionId = context.input;
          } else {
            throw new Error("Choose create or existing with a full selected session id");
          }
          // Creation and connection are separate; publication has already happened.
          context.signal.throwIfAborted();
          const connection = await sessionEvents.connect({ ...selection, sessionId });
          try {
            await requestGreeting(connection, context.signal);
            return { sessionId, message: "Companion received the greeting request. Follow the conversation in Sessions." };
          } catch (error) {
            throw new Error(`Session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
          } finally {
            // This example keeps a connection only through its receipt, not through agent work.
            connection.close();
          }
        },
      },
    };
  },
} satisfies PiWebServerPlugin;
export default plugin;

async function requestGreeting(connection: PiWebHostPiSessionConnection, requestSignal: AbortSignal): Promise<void> {
  const signal = AbortSignal.any([requestSignal, connection.signal]);
  signal.throwIfAborted();
  const requestId = randomUUID();
  let unsubscribe = () => {};
  let onAbort = () => {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      onAbort = () => { reject(new Error("Greeting receipt wait cancelled; agent work is not cancelled")); };
      signal.addEventListener("abort", onAbort, { once: true });
      timeout = setTimeout(() => { reject(new Error("No companion receipt within 5 seconds. Check package enablement/trust and reload the session; do not retry blindly.")); }, 5_000);
      unsubscribe = connection.on("session-bridge-example:reply", (data) => {
        if (typeof data !== "object" || data === null || !("requestId" in data) || data.requestId !== requestId) return;
        if ("error" in data && typeof data.error === "string") reject(new Error(data.error));
        else if ("received" in data && data.received === true) resolve();
      });
      // Native listeners can reply synchronously: always subscribe first.
      connection.emit("session-bridge-example:greet", { requestId });
    });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
    unsubscribe();
  }
}
