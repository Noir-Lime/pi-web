import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default function companion(pi: ExtensionAPI): void {
  let context: ExtensionContext | undefined;
  pi.on("session_start", (_event, ctx) => { context = ctx; });
  pi.on("session_shutdown", () => { context = undefined; });

  // Pi owns these listeners and replaces them on /reload. No startup emission to miss.
  pi.events.on("session-bridge-example:greet", (data) => {
    if (typeof data !== "object" || data === null || !("requestId" in data) || typeof data.requestId !== "string") return;
    const { requestId } = data;
    if (!context) {
      pi.events.emit("session-bridge-example:reply", { requestId, error: "Companion session is not ready" });
      return;
    }
    try {
      // Native Pi behavior, including follow-up delivery if the selected session is busy.
      pi.sendUserMessage("Say a brief hello from the session bridge example. Do not use tools.", { deliverAs: "followUp" });
      // A receipt is not an agent completion or success report. Observe the normal UI.
      pi.events.emit("session-bridge-example:reply", { requestId, received: true });
    } catch (error) {
      pi.events.emit("session-bridge-example:reply", { requestId, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
