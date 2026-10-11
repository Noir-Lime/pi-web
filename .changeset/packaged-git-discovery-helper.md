---
"@jmfederico/pi-web": patch
---

Ship a shared Git worktree notification helper inside the npm package instead of generating executable helpers in persistent data. New hooks become no-ops when the package is removed, without uninstall cleanup. Older generated helpers and registrations are left untouched.
