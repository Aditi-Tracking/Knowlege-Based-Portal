// ═══════════════════════════════════════════════════════════════
// RESPONSIVE / DEVICE DETECTION
// UA-string based device-type helpers. These do NOT read viewport
// width or use matchMedia — actual responsive layout breakpoints
// are handled entirely by CSS media queries in css/styles.css.
// These helpers exist for JS-side branching (e.g. deciding whether
// to open a file in a new tab vs. an in-page overlay, or tagging
// analytics payloads with a device type).
// ═══════════════════════════════════════════════════════════════

function isTabletDevice() {
  return /iPad/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isMobileDevice() {
  return /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent) && !isTabletDevice();
}

function isDesktopDevice() {
  return !isMobileDevice() && !isTabletDevice();
}
