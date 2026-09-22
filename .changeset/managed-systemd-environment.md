---
"@jmfederico/pi-web": patch
---

Allow unrelated environment variables when checking managed systemd services while still rejecting directly configured `PI_WEB_CONFIG` mismatches. Accept `EnvironmentFile=` with a nonfatal warning that file-based config overrides cannot be verified; readiness checks use the installed config path unless explicitly overridden for the command.

When restarting managed services, wait for the web/UI service to become ready before restarting the session daemon. If web startup fails, leave the daemon untouched. Development startup follows the same ordering and allows extra time for plugin builds.
