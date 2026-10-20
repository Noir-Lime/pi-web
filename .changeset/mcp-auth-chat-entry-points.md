---
"@jmfederico/pi-web": patch
---

Add MCP login and logout actions with a server picker and per-server controls in Settings → MCP, separate from model-provider authentication. Show the selected server and authentication outcome. Login may reuse valid credentials; logout removes local Pi credentials and disconnects without disabling the server or revoking provider access.

Restart the session daemon after updating to activate this flow; restarting interrupts active sessions and terminals.
