---
"@jmfederico/pi-web": patch
---

Reduce chat reading-position jumps by reserving space for attachments and tool images when their dimensions are available. Remember dimensions for up to 128 filesystem and external Markdown image URLs across browser reloads to reduce shifts when previously viewed images load again. Use browser-native lazy image loading; outside-workspace image approval remains temporary and separate.
