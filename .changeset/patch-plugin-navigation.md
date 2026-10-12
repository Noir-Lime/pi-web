---
"@jmfederico/pi-web": patch
---

Add opt-in patch navigation and tool-scoped query values for browser plugins, preserving unchanged sessions and unrelated panel state. Opening a Relay from a session label no longer reloads the current chat. Complete destinations remain the default with their existing non-null types; clearing a selection requires explicit patch options. Keep chat loading and live updates working when patches change the selected session, and reject malformed navigation arguments without changing the view.
