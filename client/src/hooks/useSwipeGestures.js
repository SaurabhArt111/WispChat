import { useEffect, useRef } from "react";

// Anything that should keep its own horizontal gestures / text handling.
const BLOCK_SELECTOR =
  'input, textarea, select, video, audio, canvas, [contenteditable="true"], [data-no-swipe], ' +
  ".mobile-drawer, .emoji-popover, .ctx-menu, .context-menu, .post-sheet-overlay, .media-composer";
// If any of these is on screen, a modal-ish layer owns the touch input.
const OVERLAY_SELECTOR = '[role="dialog"], .modal, .modal-backdrop, .modal-overlay, .lightbox, .status-viewer-overlay, .call-overlay';

function inHorizontalScroller(el) {
  let node = el;
  for (let depth = 0; node && node !== document.body && depth < 12; depth++, node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 6) {
      const ox = getComputedStyle(node).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
  }
  return false;
}

/**
 * Touch-only horizontal swipe detector for the mobile shell.
 * Calls onSwipe({ dir: "left" | "right", startX, width }) after a deliberate,
 * mostly-horizontal flick. Ignores inputs, videos, horizontally scrolling
 * content, open dialogs, and chat rows (which have their own swipe actions)
 * unless the gesture starts right at the screen edge.
 */
export default function useSwipeGestures({ enabled, onSwipe }) {
  const cb = useRef(onSwipe);
  cb.current = onSwipe;

  useEffect(() => {
    if (!enabled) return undefined;
    let st = null;
    const EDGE = 28;

    function onStart(e) {
      st = null;
      if (e.touches.length !== 1) return;
      if (document.querySelector(OVERLAY_SELECTOR)) return;
      const t = e.touches[0];
      const el = e.target;
      if (!(el instanceof Element)) return;
      if (el.closest(BLOCK_SELECTOR)) return;
      const atEdge = t.clientX < EDGE || t.clientX > window.innerWidth - EDGE;
      if (el.closest(".conv-swipe-wrap") && !atEdge) return;
      if (inHorizontalScroller(el)) return;
      st = { x: t.clientX, y: t.clientY, t: Date.now() };
    }
    function onEnd(e) {
      if (!st) return;
      const s = st;
      st = null;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Date.now() - s.t > 900) return;
      if (Math.abs(dx) < 72 || Math.abs(dy) > Math.abs(dx) * 0.55) return;
      cb.current({ dir: dx > 0 ? "right" : "left", startX: s.x, width: window.innerWidth });
    }
    const cancel = () => (st = null);

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", cancel);
    };
  }, [enabled]);
}
