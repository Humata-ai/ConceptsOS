import { useEffect, useRef } from "react";
import { isInput, usePreventScroll } from "./usePreventScroll";
import { isIOS, isMobileFirefox } from "./browser";

const WINDOW_TOP_OFFSET = 26;

export default function usePreventIOSContentScroll() {
  const contentRef = useRef<HTMLDivElement>(null);
  const keyboardIsOpen = useRef(false);
  const initialContentHeight = useRef(0);
  const previousDiffFromInitial = useRef(0);

  usePreventScroll();

  useEffect(() => {
    function onVisualViewportResize() {
      const el = contentRef.current;
      if (!el) return;

      const focused = document.activeElement as HTMLElement | null;
      if (!(isInput(focused) || keyboardIsOpen.current)) return;

      const vvHeight = window.visualViewport?.height || 0;
      const totalHeight = window.innerHeight;
      const diffFromInitial = totalHeight - vvHeight;
      const contentHeight = el.getBoundingClientRect().height || 0;
      const isTallEnough = contentHeight > totalHeight * 0.8;

      if (!initialContentHeight.current) initialContentHeight.current = contentHeight;
      const offsetFromTop = el.getBoundingClientRect().top;

      if (Math.abs(previousDiffFromInitial.current - diffFromInitial) > 60) {
        keyboardIsOpen.current = !keyboardIsOpen.current;
      }
      previousDiffFromInitial.current = diffFromInitial;

      if (contentHeight > vvHeight || keyboardIsOpen.current) {
        const { height } = el.getBoundingClientRect();
        let newContentHeight = height;
        if (height > vvHeight) {
          newContentHeight = vvHeight - (isTallEnough ? offsetFromTop : WINDOW_TOP_OFFSET);
        }
        el.style.height = `${Math.max(newContentHeight, vvHeight - offsetFromTop)}px`;
      } else if (!isMobileFirefox()) {
        // Keyboard closed: clear the inline height so the container falls
        // back to its CSS sizing (top:0 / bottom:0 against the parent).
        // Hardcoding window.innerHeight here overflows the parent by the
        // AppBar's height and pushes the input off the bottom of the screen.
        el.style.height = "";
      }

      el.style.bottom = `${Math.max(diffFromInitial, 0)}px`;
    }

    function onVisualViewportBlur() {
      const el = contentRef.current;
      if (!(el && isIOS())) return;
      // Clear inline overrides so CSS (top:0 / bottom:0) resizes the box
      // back to the actual parent height. Setting height to
      // window.innerHeight would overflow the parent by the AppBar height.
      el.style.height = "";
      el.style.bottom = "";
      keyboardIsOpen.current = false;
      previousDiffFromInitial.current = 0;
    }

    window.visualViewport?.addEventListener("resize", onVisualViewportResize);
    document.addEventListener("focusin", onVisualViewportResize);
    document.addEventListener("focusout", onVisualViewportBlur);
    return () => {
      window.visualViewport?.removeEventListener("resize", onVisualViewportResize);
      document.removeEventListener("focusin", onVisualViewportResize);
      document.removeEventListener("focusout", onVisualViewportBlur);
    };
  }, []);

  return { contentRef };
}
