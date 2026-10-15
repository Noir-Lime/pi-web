# UI primitives

Use shared primitives for new controls. Migrate existing controls as their surfaces are updated; a feature change does not require a whole-app restyle.

The current primitives live in `src/client/src/components/ui/controlStyles.ts`. They style native elements rather than wrapping them in custom elements, so browser focus, disabled state, form behavior, labels, and existing event handlers remain intact.

## Available primitives

| Primitive | Markup | Style export |
| --- | --- | --- |
| Button | `button.ui-button` | `uiButtonStyles` |
| Compact button | Add `ui-button--compact` | `uiButtonStyles` |
| Icon button | Add `ui-button--icon` and an accessible name | `uiButtonStyles` |
| Primary action | Add `ui-button--primary` | `uiButtonStyles` |
| Native select | `select.ui-select` | `uiButtonStyles` |
| Tabs | `.ui-tabs` with `button.ui-button.ui-tab`; optionally `ui-tabs--primary` | `uiTabStyles`, `uiToolbarStyles`, and `uiButtonStyles` |
| Secondary toolbar | `.ui-toolbar`, with optional `.ui-toolbar-title` and `.ui-toolbar-group` | `uiToolbarStyles` plus `uiButtonStyles` |
| Primary-size toolbar | Add `ui-toolbar--primary` for 44px controls | `uiToolbarStyles` plus `uiButtonStyles` |
| Bounded control group | Add `ui-toolbar-group--bounded` where a group meets empty bar space | `uiToolbarStyles` |
| Popup surface | `.ui-menu` containing native `.ui-menu-item` controls | `uiMenuStyles` plus `uiButtonStyles` |

Include the required style exports in the Lit element that owns the shadow root. `listStyles` already includes all three exports for navigation lists. Styles do not cross shadow boundaries automatically.

```ts
import { css, html, LitElement } from "lit";
import { uiButtonStyles, uiToolbarStyles } from "./ui/controlStyles";

class ExampleToolbar extends LitElement {
  static override styles = [uiButtonStyles, uiToolbarStyles, css`
    .label { align-self: center; padding-inline: 10px; }
  `];

  override render() {
    return html`
      <div class="ui-toolbar">
        <span class="ui-toolbar-title label">Files</span>
        <div class="ui-toolbar-group">
          <button type="button" class="ui-button">Refresh</button>
        </div>
      </div>
    `;
  }
}
```

Popup surfaces use a single-column layout, size to their widest item by default, and are constrained to the available space. Positioning controllers may provide a tighter maximum width; consumers should not add separate sizing rules just because the popup lives in a flex or grid container.

A popup item uses both `ui-button` and `ui-menu-item` on its native button. A checkbox option uses `ui-menu-item` on its native label, containing its input. Add `danger` for a destructive action. Keep placement, open/close state, and event handling in the owning component or its existing controller.

`ui-menu` describes the surface, not an ARIA role. Do not add `role="menu"` unless the owner implements the corresponding keyboard behavior.

## Sidebar list surfaces

`sidebarListStyles` is the shared treatment for navigation lists. Grey section headers provide hierarchy above dark, continuous rows. Keep rows full-width and gapless; do not introduce inset card surfaces or visual gutters. Selected, hover, and keyboard-focus states remain on the entire row.

## Dialog patterns

Use the existing `ModalSurface` component for focus trapping, Escape, backdrop dismissal, and dialog naming. The content patterns in `ui/dialogStyles.ts` compose with that surface; they do not add another modal controller or wrapper.

- `uiDialogStyles` provides common header, close button, search row, scrollable body, and footer treatment. It includes `uiButtonStyles`.
- `uiSelectionStyles` provides gapless option rows, composite rows with separate pin/checkbox actions, descriptions, and empty states. Combine it with `uiDialogStyles` for selections such as models, thinking levels, and Actions.
- `uiFormStyles` provides field labels, native input styling, checkbox rows, and form errors. Combine it with `uiDialogStyles` for provider login, adding machines, and adding projects. A dialog with both choices and a form can compose all three.

Use `ui-dialog-header`, `ui-dialog-title`, and a native `ui-button ui-button--icon` close button. Search inputs use `ui-dialog-search`; put a search input and adjacent actions in `ui-dialog-search-row`.

Selection lists use `ui-selection-list`; each native choice button uses `ui-button ui-selection-option`. Use `ui-selection-row` when a row has independent actions, and `ui-selection-detail` for its description. Keep existing selected-state classes and keyboard navigation with the consuming component.

Form content uses `ui-dialog-body ui-form-body`. Labels use `ui-form-field`, text inputs use `ui-input`, and checkbox labels use `ui-checkbox-field`. A native form that wraps the complete dialog uses `ui-form`. Its footer uses `ui-dialog-footer`, with native `ui-button` actions and `ui-button--primary` for the submit action. Interior action groups can use `ui-form-actions`. Labels, validation messages, input types, submit behavior, and callbacks remain local.

Keep only content-specific rules in each dialog. Existing dimension differences can use the internal composition properties `--ui-dialog-width`, `--ui-dialog-max-height`, `--ui-dialog-top`, and `--ui-dialog-z`; do not copy the common backdrop or header styles. These primitives do not introduce custom stylesheet loading or a new theming API.

## Ownership and hierarchy

- Primitives own control sizing, padding, borders, hover, focus, selected, disabled, and danger treatments. Change those centrally rather than copying them into each screen.
- Consumers own layout and domain content: labels, counts, tree indentation, popup placement, and callbacks. Preserve semantic classes used by controllers and tests alongside primitive classes.
- Standalone buttons default to 44px targets. Secondary toolbars, popup items, and compact buttons use 32px desktop targets. Coarse pointers get at least 44px height, and icon targets also get at least 44px width.
- Use shared separators, not repeated outlines or exterior gaps between related controls. A group followed by empty bar space needs a trailing boundary; use `ui-toolbar-group--bounded` rather than a one-off button border. Its separator shares the next group's leading border when the gap collapses. Do not add a trailing separator where the bar edge already bounds the group. Keep meaningful separation between unrelated groups.
- Keep the existing compact 28px desktop subsession disclosure as a specialized tree control; it is not a toolbar button.
- Check geometry in a real browser. Native-control interaction tests still belong at the consuming component boundary.

## Migration boundary

The current consumers are navigation headings, session selection controls, navigation dropdowns, the chat composer's model/thinking/send/stop toolbar, main navigation tabs, and the common selection/form dialogs. More specialized surfaces, such as Settings and session cleanup, are not yet migrated.

The internal style exports also supply the host-owned [UI styles v1 capability](plugins.md#host-provided-ui-styles). External plugins request that capability and apply its CSS inside their shadow root; they must not deep-import these client modules or bundle a copy of their styling. Relay is the first consumer. The public contract currently covers buttons, selects, toolbars, and tabs, not menus, forms, or dialogs.

Keep the documented v1 classes, markup patterns, and supported states compatible when improving their appearance. Breaking contract changes need a new capability version rather than silently changing existing plugins. Extra selectors in the generated stylesheet do not become supported APIs just because they are present.
