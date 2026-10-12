---
"@jmfederico/pi-web": patch
---

Stop the Terminal panel from re-listing terminals on every update. A requested terminal missing from a settled list refetches once per navigation intent instead of once per rendered update, so a host that rejects the fallback selection write no longer turns the panel's own list writes into an endless `terminal.list` / `terminal.list-runs` pair. Failed loads keep backing off on their existing ladder.
