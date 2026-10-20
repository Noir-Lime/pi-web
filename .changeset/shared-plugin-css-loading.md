---
"@jmfederico/pi-web": patch
---

Add file-based plugin and selected-theme stylesheets with relative asset URLs, bounded loading, visible failure diagnostics, and preserved local SVG references. Apply ready files without waiting for unrelated loads or failures, and allow failed files to retry. Built-in Dark, Light, and Classic themes now use CSS palettes through the same contribution API.

Let plugins opt shadow roots into host-managed shared buttons, selects, toolbars, tabs, and file trees without bundling a UI library or copying CSS. Provide Lit and plain-DOM integration helpers and stylesheet-change subscriptions; keep open terminal palettes in sync with theme changes. Shared styling, theme properties, and layout remain experimental.
