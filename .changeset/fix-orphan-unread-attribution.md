---
"@jmfederico/pi-web": patch
---

Clear persisted unread completions when a project is removed, clean up existing orphan entries, and stop tracking completions for unregistered workspaces. Re-adding a project starts without old unread state; session and project files are preserved. Project add/remove operations now require the session daemon so registration changes and unread cleanup are coordinated.
