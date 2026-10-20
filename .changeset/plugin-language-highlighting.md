---
"@jmfederico/pi-web": patch
---

Add local syntax highlighting for common languages in chat code blocks. Let plugins extend the bundled Highlighted renderer with language grammars or offer independent highlighting renderers, and refresh previews when grammars change. Add Mermaid source highlighting alongside the Diagram renderer for Mermaid blocks and `.mmd`/`.mermaid` files.

Keep Raw source unhighlighted and copied source unchanged. Default to the last discovered matching automatic renderer while preserving explicit choices.
