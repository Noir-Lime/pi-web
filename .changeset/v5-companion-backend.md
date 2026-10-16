---
"@jmfederico/pi-web": patch
---

Let companion extension tools call their plugin's existing v5 scoped backend through `createCompanionBackend`, sharing request and channel handlers with browser plugins without custom networking. Update PI WEB and manually restart the session daemon to enable the helper.
