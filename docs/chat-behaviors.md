# Composing chat behavior

Normal chat follows progress at the tail, remembers reading positions, loads earlier messages near the top, and offers explicit top/end navigation. Images use native `loading="lazy"` and `decoding="async"`.

## Ownership

- `ChatView` renders the transcript, tool actions, forms, and native disclosures. Closed groups keep their body DOM; recording a disclosure choice does not rebuild it. Effectful plugin renderers suspend their work while an ancestor disclosure is closed.
- `ChatScrollFlows` composes position memory, tail-follow, earlier-history loading, and one-shot prepend anchoring. Each owns and cancels its pending work independently.
- `chatBehaviors.ts` declares the capabilities injected through `PiWebApp.chatBehaviors` → `ChatView.behaviors`. All are enabled by default. This is an internal composition seam, not user-editable configuration or a diagnostic UI.
- Native images own fetching/decoding. Attachment and tool-image references include display-oriented dimensions when their headers are readable, reserving their responsive footprint before position restoration without image-load scroll corrections. Older machines, unreadable headers, and Markdown images retain native intrinsic sizing. Outside-workspace Markdown images retain explicit approval: their sources remain unset until approved, whether visible or hidden.

Scrolling does not update reactive position/index state. Earlier-history loading uses a near-top threshold and an in-flight guard. Prepending can make one height-delta adjustment when the browser/user has not already moved the viewport; it does not repeatedly settle or compensate for later image loads. Manual top/end arrows work independently of automatic flows.

## Incremental changes

To enable or disable a capability for a requested change, edit its value in `DEFAULT_CHAT_BEHAVIORS`, or inject an explicit `ChatBehaviors` value at the component boundary. Keep the effect inside its owner rather than adding ambient storage, URL switches, or alternate transcript implementations.

| Capability | Owner's responsibility |
| --- | --- |
| `rememberPosition` | Save and restore per-session reading positions |
| `followTail` | Follow new content while at the tail |
| `automaticHistory` | Request earlier history near the top |
| `anchorPrepends` | Make one adjustment after earlier messages are inserted |
| `loadImages` | Assign authorized native chat image sources |
| `rememberDisclosures` | Retain open/closed group choices |
| `visualEffects` | Apply chat sticky headers and decorative effects |

Implement and verify one UX enhancement at a time. Preserve the cancellation, authorization, and native-DOM contracts covered by the flow/component tests. For verification conventions, see [development checks](development-checks.md).
