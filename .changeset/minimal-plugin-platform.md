---
"@jmfederico/pi-web": patch
---

Introduce browser plugin API v4 and server plugin API v3, with dependency-aware lifecycles, typed capabilities, exact-package peer requests and channels, persistent plugin storage directories, and live workspace access. Plugin authors also get a typed selected-session snapshot and early validation of required hosted-session capabilities. Shipped examples and Captain's Log require PI WEB `^1.202609.1`, excluding earlier releases without these APIs.

Existing browser API v2 and server API v1 plugins require migration; there is no compatibility shim. Owner-backed `context.backend` requests are removed. Plugin IDs `pi-web` and `pi-web.*` are reserved for bundled plugins, so third-party plugins using those IDs must rename them. Terminal moves to `pi-web.terminal` while retaining `core:*` navigation aliases. Upgrade federated gateways and targets together, restart affected web/API processes and session daemons, then reload browsers.
