import { useEffect } from "react";

/**
 * Global "swipe-from-anywhere" gesture detector. MUI's SwipeableDrawer only
 * accepts swipes that start inside its `swipeAreaWidth` strip at the very
 * edge of the screen. Apps like Perplexity let you start the swipe from
 * anywhere on the screen \u2014 this hook adds that behavior on top of the
 * existing MUI drawer without replacing it.
 *
 * How it works:
 *   - Listens for touchstart at document level (passive, capture-phase).
 *   - Records the start position and tracks touchmove deltas.
 *   - Once the gesture is unambiguously a rightward horizontal swipe
 *     (|dx| > |dy| * ratio AND dx > openThreshold), fires `onOpen()`.
 *   - Cancels if the user starts scrolling vertically, releases too early,
 *     or begins the swipe inside an element that should own the gesture
 *     (a horizontal scroller, another drawer, form controls, etc.).
 *
 * The trigger is threshold-based rather than follow-finger. That means the
 * drawer opens with MUI's normal slide-in animation once the threshold is
 * crossed \u2014 not the buttery per-pixel drag you get from the edge. For a
 * hybrid feel, users who swipe from the very left still get MUI's native
 * follow-finger; users who swipe from the middle/right get this instead.
 */
export type UseGlobalSwipeToOpenOptions = {
  /** Called when a valid open swipe is detected. */
  onOpen: () => void;
  /** Skip entirely (e.g. drawer already open, desktop viewport). */
  disabled?: boolean;
  /** Horizontal distance in px that must be exceeded to trigger. */
  openThreshold?: number;
  /** How much more horizontal than vertical the motion must be. */
  directionRatio?: number;
  /**
   * Return true from this to reject a gesture that starts on the given
   * element. Default: reject inputs, buttons, links, and anything inside
   * a horizontally-scrollable container.
   */
  shouldRejectTarget?: (target: EventTarget | null) => boolean;
};

const defaultReject: NonNullable<UseGlobalSwipeToOpenOptions["shouldRejectTarget"]> = (
  target,
) => {
  if (!(target instanceof Element)) return false;
  // Native form controls should own their touch handling.
  if (target.closest("input, textarea, select, button, a[href]")) return true;
  // Don't fight a horizontally-scrollable ancestor (code blocks, carousels).
  let node: Element | null = target;
  while (node && node !== document.body) {
    const cs = window.getComputedStyle(node);
    const overflowX = cs.overflowX;
    if (
      (overflowX === "auto" || overflowX === "scroll") &&
      node.scrollWidth > node.clientWidth
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
};

export function useGlobalSwipeToOpen(options: UseGlobalSwipeToOpenOptions) {
  const {
    onOpen,
    disabled,
    openThreshold = 60,
    directionRatio = 1.4,
    shouldRejectTarget = defaultReject,
  } = options;

  useEffect(() => {
    if (disabled) return;
    if (typeof window === "undefined") return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let triggered = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      if (shouldRejectTarget(e.target)) {
        tracking = false;
        return;
      }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
      triggered = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || triggered) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      // Vertical-dominant motion: user is scrolling, abandon this gesture.
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
        tracking = false;
        return;
      }

      if (dx > openThreshold && Math.abs(dx) > Math.abs(dy) * directionRatio) {
        triggered = true;
        tracking = false;
        onOpen();
      }
    };

    const onTouchEndOrCancel = () => {
      tracking = false;
    };

    // Passive so we never fight the native scroller. Capture so we see the
    // event before component-level handlers, matching Perplexity's behavior
    // of "the drawer takes priority once you clearly swipe horizontally".
    const opts = { passive: true, capture: true } as AddEventListenerOptions;
    document.addEventListener("touchstart", onTouchStart, opts);
    document.addEventListener("touchmove", onTouchMove, opts);
    document.addEventListener("touchend", onTouchEndOrCancel, opts);
    document.addEventListener("touchcancel", onTouchEndOrCancel, opts);
    return () => {
      document.removeEventListener("touchstart", onTouchStart, opts);
      document.removeEventListener("touchmove", onTouchMove, opts);
      document.removeEventListener("touchend", onTouchEndOrCancel, opts);
      document.removeEventListener("touchcancel", onTouchEndOrCancel, opts);
    };
  }, [disabled, onOpen, openThreshold, directionRatio, shouldRejectTarget]);
}
