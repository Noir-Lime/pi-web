---
"@jmfederico/pi-web": patch
---

Add a searchable session naming model selector and token-budget controls in Settings → Session daemon. Defaults remain the session's model and 24 tokens; saved overrides apply to the next naming request without a restart. Existing names and in-progress naming requests are unchanged. Agent permission changes still require a session-daemon restart.
