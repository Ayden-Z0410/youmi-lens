/** Shared Billing / Plan modal chrome handlers (testable without a DOM). */

/** Escape-to-close handler shared with tests. */
export function handleBillingModalEscape(event: { key: string }, onClose: () => void): void {
  if (event.key === 'Escape') onClose()
}

/** Overlay mousedown closes only when the backdrop itself is the target. */
export function handleBillingModalOverlayMouseDown(
  event: { target: EventTarget | null; currentTarget: EventTarget | null },
  onClose: () => void,
): void {
  if (event.target === event.currentTarget) onClose()
}
