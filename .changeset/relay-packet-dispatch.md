---
"@jmfederico/pi-web": patch
---

Add a packet-backed `dispatch_relay` tool that generates handovers from the saved `status.md` baton and records explicit Relay membership before a new session starts. Leg identities must be strings such as `"2"` or `"R1-a"`; new session titles put the leg first so it stays visible in narrow lists. Pi extensions can also dispatch Relay legs with inherited model and thinking settings.

Add a compact “relay” link to session rows that opens the exact saved packet on the session's machine and workspace, including custom packet locations inside the workspace. Membership comes from saved metadata, not titles or handover prose.
