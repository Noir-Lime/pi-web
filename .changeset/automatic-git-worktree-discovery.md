---
"@jmfederico/pi-web": patch
---

Automatically discover new Git worktrees in connected browsers using native named hooks on supported Git builds (introduced in Git 2.54), preserving existing hooks. Add global and project-level opt-out settings that require a manual session-daemon restart, plus workspace-list catch-up after socket reconnects.

New hooks use a helper shipped inside the npm package and become no-ops when that package is removed, without uninstall cleanup. Older generated helpers and registrations are left untouched.
