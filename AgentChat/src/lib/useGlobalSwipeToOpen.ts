import { useEffect } from "react";

/**
 * Global "swipe-from-anywhere" gesture that drives the sidebar drawer
 * follow-finger, buttery-native style (Perplexity / iOS Mail feel).
 *
 * MUI's SwipeableDrawer only accepts follow-finger swipes that start inside
 * its narrow `swipeAreaWidth` strip at the edge. This hook complements that
 * by tracking touches anywhere on the screen and, once the gesture is
 * clearly a rightward horizontal swipe, imperatively translating the
 * drawer's paper element to follow the finger 1:1. On release we snap to
 * either fully open (committing via `onOpen()`) or fully closed, letting
 * MUI's Slide transition finish the last stretch.
 *
 * Design constraints:
 *   - We can't fight MUI's own touch handlers, so we set `openedByUs=true`
 *     as soon as we take over and skip our own logic when the drawer is
 *     already open (MUI handles the close swipe just fine).
 *   - React state updates are too slow for per-frame drag; we manipulate
 *     `paper.style.transform` and `backdrop.style.opacity` directly.
 *   - On commit we hand off to MUI by calling `onOpen()` and clearing our
 *     inline styles \u2014 MUI's Slide picks up from the current transform and
 *     animates the last few pixels to 0.
 */
export type UseGlobalSwipeToOpenOptions = {
  /**
   * Called once the swipe commits (finger crossed the snap-open threshold).
   * The caller MUST synchronously set both:
   *   - The MUI Drawer's `open` state to true
   *   - The Slide transition's `enter` prop to `false`
   * so that when React re-renders, MUI's Slide skips its own slide-in
   * animation. Otherwise Slide's `handleEnter` fires and *overrides* the
   * paper's transform back to translateX(-100%), causing a visible jump.
   * The hook has already animated the paper visually to translateX(0)
   * before firing this, so no animation is needed on MUI's side.
   */
  onOpen: () => void;
  /** Fully-open pixel width of the drawer paper (used to compute translate). */
  drawerWidth: number;
  /** Skip entirely (e.g. drawer already open, desktop viewport). */
  disabled?: boolean;
  /** Minimum |dx| in px before we take over the gesture. Default 8. */
  activationThreshold?: number;
  /** How much more horizontal than vertical the motion must be. Default 1.2. */
  directionRatio?: number;
  /** Fraction of drawerWidth needed to snap open on release. Default 0.35. */
  snapOpenFraction?: number;
  /** Velocity in px/ms above which we snap open regardless of position. */
  flickVelocity?: number;
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
  if (target.closest("input, textarea, select, button, a[href]")) return true;
  let node: Element | null = target;
  while (node && node !== document.body) {
    const cs = window.getComputedStyle(node);
    if (
      (cs.overflowX === "auto" || cs.overflowX === "scroll") &&
      node.scrollWidth > node.clientWidth
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
};

// The mobile SwipeableDrawer is portaled to <body>. Its paper is the sliding
// panel; the backdrop is the semi-transparent overlay behind it.
// We deliberately look for the Modal root: the desktop permanent Drawer
// shares `.MuiDrawer-paper` but is `variant="permanent"` and has no Modal
// wrapper, so restricting to `.MuiModal-root` reliably picks the temporary
// swipeable one only.
function findDrawerParts() {
  const modal = document.querySelector<HTMLElement>(".MuiModal-root");
  if (!modal) return null;
  const paper = modal.querySelector<HTMLElement>(".MuiDrawer-paper");
  const backdrop = modal.querySelector<HTMLElement>(".MuiBackdrop-root");
  if (!paper) return null;
  return { modal, paper, backdrop };
}

export function useGlobalSwipeToOpen(options: UseGlobalSwipeToOpenOptions) {
  const {
    onOpen,
    drawerWidth,
    disabled,
    activationThreshold = 8,
    directionRatio = 1.2,
    snapOpenFraction = 0.35,
    flickVelocity = 0.5,
    shouldRejectTarget = defaultReject,
  } = options;

  useEffect(() => {
    if (disabled) return;
    if (typeof window === "undefined") return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let tracking = false;
    // "engaged" = we've taken over the gesture and are driving the drawer.
    let engaged = false;
    let parts: ReturnType<typeof findDrawerParts> = null;
    // Saved inline styles we've stomped on, so we can restore them cleanly.
    let saved: {
      modalVisibility: string;
      modalPointerEvents: string;
      paperTransform: string;
      paperTransition: string;
      // MUI's Slide transition writes `visibility: hidden` directly on the
      // paper when the drawer is in the 'exited' state (Slide.js line 227),
      // so we must override the paper's own visibility too — not just the
      // modal wrapper's. Otherwise our transform is applied to a hidden
      // element and the drag appears not to follow the finger at all.
      paperVisibility: string;
      backdropOpacity: string;
      backdropTransition: string;
      backdropVisibility: string;
    } | null = null;

    const engage = () => {
      parts = findDrawerParts();
      if (!parts) return false;
      const { modal, paper, backdrop } = parts;
      // Snapshot everything we're about to override so cleanup is exact.
      saved = {
        modalVisibility: modal.style.visibility,
        modalPointerEvents: modal.style.pointerEvents,
        paperTransform: paper.style.transform,
        paperTransition: paper.style.transition,
        paperVisibility: paper.style.visibility,
        backdropOpacity: backdrop?.style.opacity ?? "",
        backdropTransition: backdrop?.style.transition ?? "",
        backdropVisibility: backdrop?.style.visibility ?? "",
      };
      // With `keepMounted`, MUI hides the closed modal via visibility:hidden.
      // We need it visible for the drag preview but must not steal taps from
      // the app until the drawer actually commits, so pointer-events:none.
      modal.style.visibility = "visible";
      modal.style.pointerEvents = "none";
      // ⬆️ Critical: MUI's Slide sets visibility:hidden on the paper itself
      // when 'exited'. Without overriding this, our transform is invisible.
      paper.style.visibility = "visible";
      paper.style.transition = "none";
      paper.style.willChange = "transform";
      if (backdrop) {
        backdrop.style.transition = "none";
        backdrop.style.visibility = "visible";
        backdrop.style.opacity = "0";
      }
      engaged = true;
      return true;
    };

    const setDragPosition = (dx: number) => {
      if (!parts) return;
      // Clamp to [0, drawerWidth] so you can't over-drag past fully-open.
      const progress = Math.max(0, Math.min(1, dx / drawerWidth));
      const translate = -drawerWidth + progress * drawerWidth;
      parts.paper.style.transform = `translate3d(${translate}px, 0, 0)`;
      if (parts.backdrop) {
        // MUI's default backdrop is rgba(0,0,0,0.5) fully faded; match that.
        parts.backdrop.style.opacity = String(progress * 0.5);
      }
    };

    // Two different "restore" modes because the drawer's target state after
    // a gesture differs by outcome:
    //   - commit: MUI is now open. Its re-render has set the correct styles
    //     for open (visibility visible, no transform inline, etc.). We want
    //     to *clear* our DOM overrides so React's props take over. If we
    //     restored the pre-drag saved values here, we'd re-hide the paper
    //     that MUI just opened — leaving an invisible modal blocking every
    //     touch on the screen.
    //   - cancel: drawer stays closed. MUI never re-rendered, so React's
    //     view of the DOM is still "paper hidden, modal hidden". We must
    //     put the DOM back exactly that way, else next-open paints stale.
    const clearInlineOverridesForCommit = () => {
      if (!parts) return;
      const { modal, paper, backdrop } = parts;
      paper.style.transition = "";
      paper.style.transform = "";
      paper.style.willChange = "";
      paper.style.visibility = "";
      modal.style.visibility = "";
      modal.style.pointerEvents = "";
      if (backdrop) {
        backdrop.style.transition = "";
        backdrop.style.visibility = "";
        backdrop.style.opacity = "";
      }
    };
    const restoreInlineStylesForCancel = () => {
      if (!parts || !saved) return;
      const { modal, paper, backdrop } = parts;
      paper.style.transition = saved.paperTransition;
      paper.style.willChange = "";
      paper.style.visibility = saved.paperVisibility;
      modal.style.visibility = saved.modalVisibility;
      modal.style.pointerEvents = saved.modalPointerEvents;
      if (backdrop) {
        backdrop.style.transition = saved.backdropTransition;
        backdrop.style.visibility = saved.backdropVisibility;
        backdrop.style.opacity = saved.backdropOpacity;
      }
    };

    const commitOpen = () => {
      // Animate ourselves the last few pixels from wherever the finger let
      // go to fully-open. We *cannot* hand this off to MUI's Slide because
      // Slide's `handleEnter` unconditionally resets the paper's transform
      // to translateX(-100%) at the start of its enter animation — which
      // would teleport the drawer back off-screen and then slide it in over
      // 225ms, exactly the "opens too fast, doesn't move with my finger"
      // artifact. Instead we drive the final stretch with a CSS transition
      // ourselves, then flip React state with Slide's `enter` disabled so
      // MUI accepts the already-open position without re-animating.
      if (!parts) return;
      const { paper, backdrop } = parts;
      const duration = 220;
      const easing = "cubic-bezier(0.32, 0.72, 0, 1)";
      paper.style.transition = `transform ${duration}ms ${easing}`;
      paper.style.transform = "translate3d(0, 0, 0)";
      if (backdrop) {
        backdrop.style.transition = `opacity ${duration}ms ${easing}`;
        backdrop.style.opacity = "0.5";
      }
      window.setTimeout(() => {
        // Flip React state: onOpen() must synchronously set MUI open=true
        // AND SlideProps.enter=false in the same batch. See onOpen docs.
        onOpen();
        // On the next frame the paper is now managed by MUI at its
        // fully-open position — wipe our inline overrides so React's
        // open-state styles (visibility visible, no inline transform,
        // modal pointer-events auto) actually apply. Do NOT restore the
        // saved pre-drag values here — those were captured while the
        // drawer was closed and would re-hide the paper we just opened,
        // trapping the whole page under an invisible modal.
        requestAnimationFrame(() => {
          clearInlineOverridesForCommit();
          parts = null;
          saved = null;
        });
      }, duration);
    };

    const cancelDrag = () => {
      if (!parts) return;
      const { paper, backdrop } = parts;
      // Animate the paper back off-screen. Use MUI's own easing feel.
      const duration = 200;
      const easing = "cubic-bezier(0.32, 0.72, 0, 1)";
      paper.style.transition = `transform ${duration}ms ${easing}`;
      paper.style.transform = `translate3d(${-drawerWidth}px, 0, 0)`;
      if (backdrop) {
        backdrop.style.transition = `opacity ${duration}ms ${easing}`;
        backdrop.style.opacity = "0";
      }
      // After the animation, restore the saved pre-drag styles so MUI's
      // closed state (paper hidden, modal hidden) is visually accurate
      // again. React never re-rendered, so it still expects those values.
      window.setTimeout(() => {
        if (!parts) return;
        parts.paper.style.transform = "";
        if (parts.backdrop) parts.backdrop.style.opacity = "";
        restoreInlineStylesForCancel();
        parts = null;
        saved = null;
      }, duration + 20);
    };

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
      startX = lastX = t.clientX;
      startY = t.clientY;
      startTime = lastT = performance.now();
      velocity = 0;
      tracking = true;
      engaged = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!engaged) {
        // Vertical-dominant motion \u2192 user is scrolling, bail permanently.
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
          tracking = false;
          return;
        }
        // Not enough motion yet to classify.
        if (dx < activationThreshold || Math.abs(dx) < Math.abs(dy) * directionRatio) {
          return;
        }
        if (!engage()) {
          tracking = false;
          return;
        }
      }

      // Track velocity for flick detection.
      const now = performance.now();
      const dt = now - lastT;
      if (dt > 0) {
        // Simple low-pass filter so a jittery finger doesn't spike velocity.
        velocity = velocity * 0.5 + ((t.clientX - lastX) / dt) * 0.5;
      }
      lastX = t.clientX;
      lastT = now;

      setDragPosition(dx);
    };

    const onTouchEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!engaged) return;
      engaged = false;

      const totalDx = lastX - startX;
      const commit =
        totalDx >= drawerWidth * snapOpenFraction || velocity >= flickVelocity;
      if (commit) commitOpen();
      else cancelDrag();
    };

    const onTouchCancel = () => {
      if (engaged) cancelDrag();
      tracking = false;
      engaged = false;
    };

    // Capture-phase so we see the events before app content. Non-passive on
    // touchmove because we may need to preventDefault vertical rubber-band
    // once we're engaged (otherwise iOS scrolls the page while we drag).
    document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true, capture: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart, { capture: true });
      document.removeEventListener("touchmove", onTouchMove, { capture: true });
      document.removeEventListener("touchend", onTouchEnd, { capture: true });
      document.removeEventListener("touchcancel", onTouchCancel, { capture: true });
      // If the hook is torn down mid-drag, restore styles so we don't leave
      // the drawer visually stuck half-open.
      if (engaged) {
        restoreInlineStylesForCancel();
        parts = null;
        saved = null;
      }
    };
    // startTime is intentionally left as a mutable closure ref via let;
    // we don't need it in the deps.
    void startTime;
  }, [
    disabled,
    onOpen,
    drawerWidth,
    activationThreshold,
    directionRatio,
    snapOpenFraction,
    flickVelocity,
    shouldRejectTarget,
  ]);
}
