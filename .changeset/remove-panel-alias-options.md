---
"@jmfederico/pi-web": patch
---

Remove legacy panel aliases and historical panel links. Plugins must remove `routeAliases` and `navigationAliases` to register, and saved links must use current panel IDs; see the [panel migration guide](https://pi-web.dev/plugins#panel-and-tab-navigation).
