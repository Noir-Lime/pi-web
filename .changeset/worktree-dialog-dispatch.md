---
"@jmfederico/pi-web": patch
---

Add a Create Worktree dialog for the base branch and purpose, then invoke the same `/worktree` prompt in a fresh conversation in the project's main workspace without changing the current conversation or draft. Requests use readable base and description text, preserving multiline descriptions and literal quotes. The Workflows web plugin now requires a session-daemon restart after updating.
