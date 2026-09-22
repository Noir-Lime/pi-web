---
"@jmfederico/pi-web": patch
---

Preserve requested URLs for unavailable machines, projects, workspaces, sessions, and tools instead of silently showing a different destination. Show failures in the requested content area and leave valid tabs available for recovery. Unknown views show a warning and a responsive display fallback without rewriting the URL; the warning clears on valid navigation. Panel selection (`view=navigation|chat|workspace`) is now separate from workspace tab selection (`tool`); old URLs that put a tab ID in `view` need updating.
