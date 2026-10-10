---
"@jmfederico/pi-web": patch
---

Simplify chat scrolling and image rendering. Keep remembered reading positions, follow ongoing progress at the bottom, and load earlier messages near the top, with compact jump-to-top/end arrows replacing the scroll meter. Use native lazy/async images and persistent disclosure bodies instead of custom image observers and layout corrections, while retaining image enlargement and outside-workspace approval.
