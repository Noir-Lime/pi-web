/** Independent chat capabilities; overrides are injected, not read from ambient storage. */
export interface ChatBehaviors {
  readonly rememberPosition: boolean;
  readonly followTail: boolean;
  readonly automaticHistory: boolean;
  readonly anchorPrepends: boolean;
  readonly loadImages: boolean;
  readonly rememberDisclosures: boolean;
  readonly visualEffects: boolean;
}

export const DEFAULT_CHAT_BEHAVIORS: ChatBehaviors = Object.freeze({
  rememberPosition: true,
  followTail: true,
  automaticHistory: true,
  anchorPrepends: true,
  loadImages: true,
  rememberDisclosures: true,
  visualEffects: true,
});
