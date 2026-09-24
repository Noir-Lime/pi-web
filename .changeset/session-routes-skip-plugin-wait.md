---
"@jmfederico/pi-web": patch
---

Restore project, workspace, and session URLs without waiting for plugin modules to load. Only routes that name a workspace tool still wait for plugins, so opening a session link on a slow connection no longer blocks on every plugin download.
