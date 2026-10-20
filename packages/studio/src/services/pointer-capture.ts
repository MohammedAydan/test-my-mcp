/**
 * Pointer-capture helpers.
 *
 * `setPointerCapture` throws `NotFoundError` when there is no ACTIVE pointer
 * with the given id — which happens with synthetic events (automated tests)
 * and, in the wild, when the pointer was released between the event and the
 * handler. A capture failure must never abort an interaction, so it is
 * swallowed here.
 */

export function capturePointer(element: Element | undefined, pointerId: number): void {
  if (!element || typeof element.setPointerCapture !== 'function') return;
  try {
    element.setPointerCapture(pointerId);
  } catch {
    /* no active pointer — the interaction still works without capture */
  }
}

export function releasePointer(element: Element | undefined, pointerId: number): void {
  if (!element || typeof element.releasePointerCapture !== 'function') return;
  try {
    element.releasePointerCapture(pointerId);
  } catch {
    /* the pointer was already released */
  }
}
