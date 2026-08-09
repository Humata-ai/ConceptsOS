"use client";
import { useEffect } from "react";

/**
 * iOS Safari fallback for when `interactive-widget=resizes-content` isn't
 * honored. Publishes:
 *   --kb-inset: how many CSS px of screen are covered by the on-screen keyboard
 *   --vv-offset-top: how far the visual viewport has been scrolled from the
 *                    layout viewport top (non-zero while iOS keyboard is open)
 *
 * mathix.dev formula: bottom offset a fixed element needs to sit above the
 * keyboard is `max(0, innerHeight - visualViewport.height - offsetTop)`.
 */
export default function KeyboardInsets() {
  useEffect(() => {
    const vv = window.visualViewport;

    const update = () => {
      const h =
        vv?.height ?? window.innerHeight ?? document.documentElement.clientHeight;
      const off = vv?.offsetTop ?? 0;
      const inset = Math.max(0, window.innerHeight - h - off);
      const root = document.documentElement.style;
      root.setProperty("--kb-inset", `${inset}px`);
      root.setProperty("--vv-offset-top", `${off}px`);
      root.setProperty("--vv-height", `${h}px`);
    };

    // iOS still scrolls the layout viewport into view when an input is
    // focused, even with html/body position:fixed. Actively snap it back.
    const resetScroll = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };
    const onFocusIn = () => {
      // Reset multiple times across the focus animation frames iOS uses.
      resetScroll();
      requestAnimationFrame(resetScroll);
      setTimeout(resetScroll, 50);
      setTimeout(resetScroll, 150);
      setTimeout(resetScroll, 350);
    };

    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("scroll", resetScroll, { passive: true });
    document.addEventListener("focusin", onFocusIn);

    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("scroll", resetScroll);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);
  return null;
}
