---
"@jmfederico/pi-web": patch
---

Replace browser plugin API v2 with v4 and server plugin API v1 with v3. Migrate plugins to the dependency-aware activation, start, lifetime, and disposal lifecycle; exact typed capabilities; and exact-package `peer` requests/channels. Server plugins can use host-governed package state, live workspace authority, and bounded one-shot Pi sessions. Owner-backed requests and private Terminal composition fields are removed.
