# Composing chat behavior

Normal chat follows progress at the tail, remembers reading positions, loads earlier messages near the top, and offers explicit top/end navigation. Images use native `loading="lazy"` and `decoding="async"`.

## Ownership

- `ChatView` renders the transcript, tool actions, forms, and native disclosures. It captures native transcript disclosure toggles and reports layout changes to `ChatScrollFlows`, independently of remembering disclosure choices. Closed groups keep their body DOM; recording a disclosure choice does not rebuild it. Effectful plugin renderers suspend their work while an ancestor disclosure is closed.
- `ChatScrollFlows` composes position memory, tail-follow, earlier-history loading, and one-shot prepend anchoring. Each owns and cancels its pending work independently.
- `chatBehaviors.ts` declares the capabilities injected through `PiWebApp.chatBehaviors` → `ChatView.behaviors`. All are enabled by default. This is an internal composition seam, not user-editable configuration or a diagnostic UI.
- Native images own fetching/decoding. Attachment and tool-image references include display-oriented dimensions when their headers are readable, reserving their responsive footprint before position restoration without image-load scroll corrections. Older machines, unreadable headers, and Markdown images retain native intrinsic sizing. Outside-workspace Markdown images retain explicit approval: their sources remain unset until approved, whether visible or hidden.

Scrolling does not update reactive position/index state; only a change of live-follow mode updates its indicator. Earlier-history loading uses a near-top threshold and an in-flight guard. Prepending can make one height-delta adjustment when the browser/user has not already moved the viewport; it does not repeatedly settle or compensate for later image loads. Manual top/end arrows work independently of automatic flows.

## Following live

The highlighted ↓ arrow means new transcript content follows automatically, whether or not the session is currently streaming. Its tooltip and accessible description report the same mode.

- Press ↓ to jump to the latest content and enable following. Pressing it again keeps following enabled.
- Scroll down to the actual bottom to resume following, allowing less than two pixels for rounding rather than a near-bottom zone.
- Upward wheel/touch input, native upward scrolling away from the bottom, or ↑ pauses following. A stationary scroll event does not undo that choice.
- Content growth and viewport changes retain the selected mode. Native overscroll is clamped for direction detection, so a bottom rebound does not count as reading history.
- Expanding or collapsing a transcript disclosure catches up to the new bottom in one coalesced scroll frame while following. Paused reading views are left alone.
- Restoring a historical reading position, or aligning an open form away from the bottom, pauses following; the arrow shows that pause too.

When the `followTail` capability is disabled, ↓ remains a jump-only control and is not highlighted. This behavior adds no image-load corrections, continuous polling, or layout-settling loop; other late descendant layout changes remain browser-owned.

## Incremental changes

To enable or disable a capability for a requested change, edit its value in `DEFAULT_CHAT_BEHAVIORS`, or inject an explicit `ChatBehaviors` value at the component boundary. Keep the effect inside its owner rather than adding ambient storage, URL switches, or alternate transcript implementations.

| Capability | Owner's responsibility |
| --- | --- |
| `rememberPosition` | Save and restore per-session reading positions |
| `followTail` | Follow new content while live-follow mode is selected |
| `automaticHistory` | Request earlier history near the top |
| `anchorPrepends` | Make one adjustment after earlier messages are inserted |
| `loadImages` | Assign authorized native chat image sources |
| `rememberDisclosures` | Retain open/closed group choices |
| `visualEffects` | Apply chat sticky headers and decorative effects |

Implement and verify one UX enhancement at a time. Preserve the cancellation, authorization, and native-DOM contracts covered by the flow/component tests. For verification conventions, see [development checks](development-checks.md).
