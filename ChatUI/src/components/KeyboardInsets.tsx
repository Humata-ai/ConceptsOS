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
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const root = document.documentElement.style;
      root.setProperty("--kb-inset", `${inset}px`);
      root.setProperty("--vv-offset-top", `${vv.offsetTop}px`);
      root.setProperty("--vv-height", `${vv.height}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return null;
}
