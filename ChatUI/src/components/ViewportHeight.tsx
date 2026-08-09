"use client";
import { useEffect } from "react";

/**
 * On iOS Safari, focusing an input opens the keyboard and shrinks the visual
 * viewport, but 100dvh doesn't always update fast enough (and iOS can still
 * scroll a "position: fixed" root). Track window.visualViewport and publish
 * the real height as a CSS variable so the layout pins to it.
 */
export default function ViewportHeight() {
  useEffect(() => {
    const set = () => {
      const h =
        window.visualViewport?.height ??
        window.innerHeight ??
        document.documentElement.clientHeight;
      document.documentElement.style.setProperty("--app-height", `${h}px`);
    };
    set();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", set);
    vv?.addEventListener("scroll", set);
    window.addEventListener("resize", set);
    window.addEventListener("orientationchange", set);
    return () => {
      vv?.removeEventListener("resize", set);
      vv?.removeEventListener("scroll", set);
      window.removeEventListener("resize", set);
      window.removeEventListener("orientationchange", set);
    };
  }, []);
  return null;
}
