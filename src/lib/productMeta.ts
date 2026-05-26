/** Shipped build label for Settings / Account About (not wired to package.json). */
export const PRODUCT_VERSION_LABEL = 'Youmi Lens v0.1' as const

/**
 * Short release note shown in Settings / Account. Constant name retained for
 * back-compat with existing imports; the visible string is now Beta-free.
 */
export const INTERNAL_BETA_NOTE =
  'This is an early Youmi Lens build. Please report issues with recording, realtime captions, transcript, summary, and library actions.' as const
