---
"@jmfederico/pi-web": patch
---

Keep agent questions as saved conversation entries. Only the question set at the conversation's tail is open; earlier forms stay expandable and read-only in place. Questions survive session-daemon restarts, and answers or skips resume the agent without a separate pending-question lifecycle.
