---
"@jmfederico/pi-web": patch
---

Add browser and server plugin API v5 with read-only project, workspace, and session catalogs and machine-, project-, and workspace-scoped backend access. Let companion extension tools reuse their plugin's backend request and channel handlers through `createCompanionBackend`, without custom networking. Deliver companion channel data only after opening succeeds.

Keep deprecated browser v4 and server v3 plugins supported, including v4 token-based themes and compatible independently versioned capabilities. New stylesheet, syntax-highlighter, and renderer contribution fields require v5.

After updating PI WEB, manually restart the session daemon when safe to enable the backend capabilities and companion helper. Restarting interrupts active sessions and terminals.
