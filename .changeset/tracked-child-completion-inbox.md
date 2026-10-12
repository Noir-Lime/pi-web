---
"@jmfederico/pi-web": patch
---

Fix duplicate tracked-child result delivery by sharing unread completions across yield, inspection, and automatic notices. Yield returns unread completed results immediately even while other children are working, and acknowledged completions are not automatically replayed.
