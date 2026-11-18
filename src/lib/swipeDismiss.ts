export const SWIPE_ACTIVATE_THRESHOLD_PX = 6;
export const SWIPE_DISMISS_DISTANCE_PX = 96;
export const SWIPE_DISMISS_VELOCITY_PX_PER_MS = 0.45;

/**
 * Returns non-negative downward drag distance when downward swipe intent dominates,
 * or 0 if movement is upward, horizontal, or below jitter threshold.
 */
export function computeSwipeOffset(
  deltaY: number,
  deltaX: number,
  allowDrag: boolean
): number {
  if (!allowDrag) return 0;
  if (deltaY <= SWIPE_ACTIVATE_THRESHOLD_PX) return 0;
  if (deltaY < Math.abs(deltaX)) return 0;
  return Math.round(deltaY - SWIPE_ACTIVATE_THRESHOLD_PX);
}

/**
 * Determines whether a completed downward swipe should dismiss the overlay
 * based on absolute drag distance or downward flick velocity.
 */
export function shouldDismissSwipe(offsetY: number, elapsedMs: number): boolean {
  if (!Number.isFinite(offsetY) || offsetY <= 0) return false;
  if (offsetY >= SWIPE_DISMISS_DISTANCE_PX) return true;
  if (offsetY >= 40 && Number.isFinite(elapsedMs) && elapsedMs > 0) {
    const velocity = offsetY / elapsedMs;
    return velocity >= SWIPE_DISMISS_VELOCITY_PX_PER_MS;
  }
  return false;
}

/**
 * Maps current swipe drag distance to a smooth backdrop opacity multiplier (0.25..1).
 */
export function computeBackdropOpacity(offsetY: number): number {
  if (!Number.isFinite(offsetY) || offsetY <= 0) return 1;
  return Math.max(0.25, Number((1 - Math.min(offsetY, 300) / 360).toFixed(3)));
}
