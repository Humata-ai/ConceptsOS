export function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Mac; detect via touch support.
  return (
    /iP(ad|hone|od)/.test(ua) ||
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1)
  );
}

export function isMobileFirefox(): boolean {
  if (typeof window === "undefined") return false;
  return /Firefox/.test(navigator.userAgent) && /Mobi|Android/.test(navigator.userAgent);
}
