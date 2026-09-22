---
"@jmfederico/pi-web": patch
---

Add plugin-provided previews to chat Markdown, Files Markdown previews, and standalone text files, including bundled Mermaid diagrams rendered locally in a network-blocked sandbox. Previews default to manual rendering unless a plugin opts into automatic rendering; raw source and copying remain available during streaming or failures.

Choose a renderer and switch between Render and Raw per diagram or file. Files respects saved Raw/Preview preferences and URL overrides, with scrollable previews and a pinned header. Chat remembers explicit per-diagram choices in the current tab for 15 minutes; changed source or unavailable renderers clear those choices.
