---
"@jmfederico/pi-web": patch
---

Add plugin indicators to individual session-list rows, supporting public session metadata, text, links, and custom rendering. Keep rows compact with a single-line title and message counts and plugin labels together on the second line. If a plugin label callback or render item fails, skip only that contribution and log its identity in the browser console without breaking the session list.
