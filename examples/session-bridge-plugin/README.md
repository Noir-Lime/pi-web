# PI WEB session bridge example

A copyable package with a PI WEB browser/backend pair and an ordinary Pi companion extension. Two buttons send the same greeting request: one creates a conversation first, the other targets the explicitly selected hosted session. The companion replies on `pi.events` and uses native `pi.sendUserMessage` to start work. PI WEB displays the conversation and running state normally.

## Build and enable

Copy this directory out of the repository or installed PI WEB package. Use PI WEB `^2.202609.0` with the creation and session-events capabilities; the native companion is tested with Pi 0.85.1. During unreleased development, install the locally built PI WEB tarball instead of the registry dependency.

```sh
npm install
npm run build
```

On the target machine, use **Settings → Pi packages** to install this absolute package directory. This lets PI WEB discover its `piWeb` entries and Pi load its companion. Check that the Session Bridge Example plugin and companion resource are enabled. Do not also link a second copy into the PI WEB plugins directory.

For manual configuration, use the **same target machine's Pi agent configuration used by sessiond**, not an unrelated terminal Pi profile. Add this absolute package directory to its `settings.json` `packages` array (preserve existing entries):

```json
{ "packages": ["/absolute/path/to/session-bridge-plugin"] }
```

Alternatively, `pi install /absolute/path/to/session-bridge-plugin` updates the CLI's active Pi profile; use that only when it is the profile sessiond uses. Project-local installation (`pi install -l ...` from the workspace) requires the normal project trust decision. Package/resource filters must leave `src/companion.ts` enabled. The `pi` manifest and `piWeb` manifest serve different loaders; enabling the PI WEB backend alone does not install the companion in sessions.

Manually restart the target session daemon when safe, then reload the browser. This can interrupt hosted sessions; do not restart a daemon from a session it hosts. A web/API restart alone does not activate a server entry. For remote machines, install/build/enable on that machine and select it in PI WEB.

## Try it

1. Select a project/workspace and open its **Session Bridge** panel.
2. Click **Create session and greet**. Handle any normal startup/trust dialogs. The panel reports the full session id and a companion receipt; open that conversation in Sessions to see the agent reply and continue it normally.
3. Select an existing conversation in that workspace, then click **Greet selected session**. A saved session must already be opened/hosted, with extension startup finished. If the companion was just enabled, use `/reload` there before clicking. When busy, Pi queues the greeting as a follow-up rather than interrupting user work.

A model and its credentials must be configured on the target machine for an agent response. The receipt means the companion received the request, **not** that the provider succeeded. See normal session output for errors or cancellation. The example does not automatically retry a missing receipt: work may already have started.

## Ownership and cleanup

- `src/browser/index.ts` uses the panel's selected-machine `context.peer`; only the existing session's full id is payload. The backend derives project/workspace ids from the host-resolved request context. No cached machine-global destination is used.
- `src/server.ts` declares both exact capability requirements and resolves them in `start()`. It calls `piSessions.create(selection)` only for the new-session button, then separately `sessionEvents.connect(selection)` for either button.
- The backend subscribes before emitting a correlated author-defined request. It waits at most five seconds for a reply, observes both request cancellation and `connection.signal`, and always removes listeners/timers and closes the connection. Closing never stops agent work or removes the conversation. A cancelled create request can still leave a normally hosted conversation; check Sessions before creating another.
- `src/companion.ts` registers listeners while loading and receives session context in `session_start`. Pi replaces companion listeners on `/reload`; shutdown clears its captured context. There are no startup emissions to replay and no SDK runtime to adopt.
- Same-session `/reload` keeps host connections alive, but runtime closure/replacement invalidates them. Longer-lived integrations should observe `connection.signal` and explicitly reconnect to a newly selected hosted runtime. Browser disconnect alone does not invalidate backend-owned connections; this example deliberately uses a request-scoped receipt wait.

This is trusted-author tooling, not a sandbox. Define your own channels, payloads, receipts, and errors; Pi remains the agent API. The small receipt protocol is not durable messaging or an agent-event mirror.

The example uses `skipLibCheck` for native Pi's dependency declarations; source remains strict. PI WEB's standalone browser/backend declarations are separately checked with library checking enabled by the repository's installed-package smoke.

See the [canonical plugin guide](https://pi-web.dev/plugins) for capability limits, package discovery/configuration, peer request bounds, and lifecycle contracts.
