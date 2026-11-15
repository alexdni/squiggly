// Scrolling the trace window through time: wheel, drag and keyboard, as pure functions.

/** A press that moves less than this is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 4;
const WHEEL_LINE_PX = 16;

/**
 * Horizontal pixels a wheel event asks to scroll: sideways trackpad/wheel movement, or a vertical
 * wheel with Shift. 0 for plain vertical scrolling, which is left to the page.
 */
export function wheelPanPixels(e: { deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean }): number {
  const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? 400 : 1;
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return e.deltaX * unit;
  return e.shiftKey ? e.deltaY * unit : 0;
}

/** Seconds to move for a key, or null when the key does not scroll. Home/End return ±Infinity. */
export function keyPanSeconds(key: string, shiftKey: boolean, windowSeconds: number): number | null {
  switch (key) {
    case 'ArrowLeft':
      return -(shiftKey ? windowSeconds : windowSeconds / 10);
    case 'ArrowRight':
      return shiftKey ? windowSeconds : windowSeconds / 10;
    case 'PageUp':
      return -windowSeconds;
    case 'PageDown':
      return windowSeconds;
    case 'Home':
      return -Infinity;
    case 'End':
      return Infinity;
    default:
      return null;
  }
}

/** Window start after moving by `deltaSeconds`, kept inside the recording. */
export function panStart(start: number, deltaSeconds: number, windowSeconds: number, duration: number): number {
  const max = Math.max(0, duration - windowSeconds);
  if (deltaSeconds === -Infinity) return 0;
  if (deltaSeconds === Infinity) return max;
  return Math.min(max, Math.max(0, start + deltaSeconds));
}
