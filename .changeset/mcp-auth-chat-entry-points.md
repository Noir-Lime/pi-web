---
"@jmfederico/pi-web": patch
---

Add separate MCP login and MCP logout actions with an explicit server picker, plus per-server controls in Settings → MCP. Keep MCP authentication separate from model-provider dialogs. Show the chosen server and Pi’s outcome; Pi may reuse valid or refreshable credentials without browser authorization. Logout removes local Pi credentials and disconnects the authenticated connection without disabling the server or revoking provider access.

Manually restart the session daemon after updating to activate this flow; restarting interrupts active sessions and terminals.
