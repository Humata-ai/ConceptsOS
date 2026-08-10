/* Adapted from Adobe react-aria usePreventScroll + the extensions described in
 * https://medium.com/@ivangrsk.it/taming-the-ios-keyboard-in-react-how-to-make-inputs-feel-native-2b8838e04da4
 * Trimmed to the pieces we need for Mobile Safari focus-scroll suppression. */

import { useEffect, useLayoutEffect } from "react";
import { isIOS } from "./browser";

const KEYBOARD_BUFFER = 24;

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

type PreventScrollOptions = { isDisabled?: boolean };

function chain(...cbs: Array<((...args: unknown[]) => void) | undefined>) {
  return (...args: unknown[]) => {
    for (const cb of cbs) if (typeof cb === "function") cb(...args);
  };
}

const nonTextInputTypes = new Set([
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "image",
  "button",
  "submit",
  "reset",
]);

export function isInput(target: Element | null): target is HTMLElement {
  if (!target) return false;
  return (
    (target instanceof HTMLInputElement && !nonTextInputTypes.has(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isScrollable(node: Element): boolean {
  const s = window.getComputedStyle(node);
  return /(auto|scroll)/.test(s.overflow + s.overflowX + s.overflowY);
}

function getScrollParent(node: Element): Element {
  let n: Element | null = node;
  if (n && isScrollable(n)) n = n.parentElement;
  while (n && !isScrollable(n)) n = n.parentElement;
  return n || document.scrollingElement || document.documentElement;
}

let preventScrollCount = 0;
let restore: (() => void) | undefined;

export function usePreventScroll(options: PreventScrollOptions = {}) {
  const { isDisabled } = options;
  useIsomorphicLayoutEffect(() => {
    if (isDisabled) return;
    preventScrollCount++;
    if (preventScrollCount === 1 && isIOS()) restore = preventScrollMobileSafari();
    return () => {
      preventScrollCount--;
      if (preventScrollCount === 0) restore?.();
    };
  }, [isDisabled]);
}

function setStyle(el: HTMLElement, prop: string, value: string) {
  const style = el.style as unknown as Record<string, string>;
  const prev = style[prop];
  style[prop] = value;
  return () => {
    style[prop] = prev;
  };
}

function addEvent<K extends keyof DocumentEventMap>(
  target: EventTarget,
  event: K,
  handler: (e: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(event, handler as EventListener, options);
  return () => target.removeEventListener(event, handler as EventListener, options);
}

function scrollIntoView(target: Element) {
  const root = document.scrollingElement || document.documentElement;
  let node: Element | null = target;
  while (node && node !== root) {
    const scrollable = getScrollParent(node);
    if (
      scrollable !== document.documentElement &&
      scrollable !== document.body &&
      scrollable !== node
    ) {
      const scrollableTop = scrollable.getBoundingClientRect().top;
      const targetTop = node.getBoundingClientRect().top;
      const targetBottom = node.getBoundingClientRect().bottom;
      const keyboardHeight = scrollable.getBoundingClientRect().bottom + KEYBOARD_BUFFER;
      if (targetBottom > keyboardHeight) {
        scrollable.scrollTop += targetTop - scrollableTop;
      }
    }
    node = scrollable.parentElement;
  }
}

function preventScrollMobileSafari() {
  let scrollable: Element;
  let lastY = 0;
  let startX = 0;
  let startY = 0;
  // Once a touch is classified as a horizontal-dominant swipe we let every
  // subsequent move in the same gesture pass through untouched — otherwise
  // MUI's SwipeableDrawer (and any other horizontal gesture) can't see the
  // events, because this listener runs at capture with passive:false.
  let horizontalSwipe = false;

  const onTouchStart = (e: TouchEvent) => {
    scrollable = getScrollParent(e.target as Element);
    const t = e.changedTouches[0];
    lastY = t.pageY;
    startX = t.pageX;
    startY = t.pageY;
    horizontalSwipe = false;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (horizontalSwipe) return;
    const t = e.changedTouches[0];
    const dx = t.pageX - startX;
    const dy = t.pageY - startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    // Wait until the gesture has moved enough to know its direction. Calling
    // preventDefault() during this window would mark the event as handled
    // and stop MUI's SwipeableDrawer (which bails on defaultPrevented) from
    // ever picking up the edge-swipe. 8px is roughly iOS's own recognizer.
    if (adx < 8 && ady < 8) return;

    // Horizontal-dominant → let it through for the rest of the gesture so
    // SwipeableDrawer (and other horizontal handlers) can drive it.
    if (adx > ady) {
      horizontalSwipe = true;
      return;
    }

    if (!scrollable || scrollable === document.documentElement || scrollable === document.body) {
      e.preventDefault();
      return;
    }
    const y = t.pageY;
    const { scrollTop } = scrollable as HTMLElement;
    const bottom = scrollable.scrollHeight - scrollable.clientHeight;
    if (bottom === 0) return;
    if ((scrollTop <= 0 && y > lastY) || (scrollTop >= bottom && y < lastY)) e.preventDefault();
    lastY = y;
  };

  const onTouchEnd = (e: TouchEvent) => {
    const target = e.target as HTMLElement;
    if (isInput(target) && target !== document.activeElement) {
      e.preventDefault();
      target.style.transform = "translateY(-2000px)";
      target.focus();
      requestAnimationFrame(() => {
        target.style.transform = "";
      });
    }
  };

  const onFocus = (e: FocusEvent) => {
    const target = e.target as HTMLElement;
    if (!isInput(target)) return;
    target.style.transform = "translateY(-2000px)";
    requestAnimationFrame(() => {
      target.style.transform = "";
      const vv = window.visualViewport;
      if (vv) {
        if (vv.height < window.innerHeight) {
          requestAnimationFrame(() => scrollIntoView(target));
        } else {
          vv.addEventListener("resize", () => scrollIntoView(target), { once: true });
        }
      }
    });
  };

  const onWindowScroll = () => {
    if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
  };

  const scrollX = window.pageXOffset;
  const scrollY = window.pageYOffset;

  const restoreStyles = chain(
    setStyle(
      document.documentElement,
      "paddingRight",
      `${window.innerWidth - document.documentElement.clientWidth}px`,
    ),
  );

  window.scrollTo(0, 0);

  const removeEvents = chain(
    addEvent(document, "touchstart", onTouchStart, { passive: false, capture: true }),
    addEvent(document, "touchmove", onTouchMove, { passive: false, capture: true }),
    addEvent(document, "touchend", onTouchEnd, { passive: false, capture: true }),
    addEvent(document, "focus", onFocus, true),
    addEvent(window, "scroll", onWindowScroll),
  );

  return () => {
    restoreStyles();
    removeEvents();
    window.scrollTo(scrollX, scrollY);
  };
}
