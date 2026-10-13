import { useEffect, useRef } from "react";

// Things that keep their own horizontal / text gestures.
const BLOCK =
  'input, textarea, select, video, audio, canvas, [contenteditable="true"], [data-no-swipe], ' +
  ".emoji-popover, .ctx-menu, .context-menu, .media-composer, .lightbox";
const OVERLAY = '[role="dialog"], .modal, .modal-backdrop, .modal-overlay, .lightbox, .status-viewer-overlay, .call-overlay, .media-composer';

function inHScroller(el) {
  for (let n = el, d = 0; n && n !== document.body && d < 12; d++, n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 6) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
  }
  return false;
}

/**
 * Drag-to-close for the mobile chat window — the same feel as the side drawer:
 * the chat follows your finger to the right, the chat list is revealed
 * underneath (with a small parallax), and on release it either flies off and
 * leaves the chat, or springs back.
 *
 * All motion is applied straight to the DOM (no React state per touchmove),
 * so it stays at 60fps even in a long conversation.
 */
export default function useSwipeBack({ enabled, shellRef, onBack }) {
  const back = useRef(onBack);
  back.current = onBack;

  useEffect(() => {
    if (!enabled) return undefined;
    const shell = shellRef.current;
    if (!shell) return undefined;
    let st = null;
    let timer = null;

    const main = () => shell.querySelector(".app-main");
    const setProgress = (dx, w) => {
      const m = main();
      if (!m) return;
      m.style.transform = `translate3d(${dx}px,0,0)`;
      shell.style.setProperty("--under-x", `${-28 * (1 - Math.min(1, dx / w))}%`);
      shell.style.setProperty("--under-dim", String(0.5 * (1 - Math.min(1, dx / w))));
    };
    const cleanup = () => {
      const m = main();
      if (m) {
        m.style.transform = "";
        m.style.transition = "";
      }
      shell.classList.remove("chat-dragging");
      shell.style.removeProperty("--under-x");
      shell.style.removeProperty("--under-dim");
    };

    function onStart(e) {
      st = null;
      if (e.touches.length !== 1) return;
      const el = e.target;
      if (!(el instanceof Element) || !el.closest(".chat-window")) return;
      if (el.closest(BLOCK) || document.querySelector(OVERLAY) || inHScroller(el)) return;
      clearTimeout(timer);
      cleanup();
      const t = e.touches[0];
      st = { x: t.clientX, y: t.clientY, t: Date.now(), active: false, lastX: t.clientX, lastT: Date.now(), v: 0 };
    }

    function onMove(e) {
      if (!st) return;
      const t = e.touches[0];
      const dx = t.clientX - st.x;
      const dy = t.clientY - st.y;
      if (!st.active) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { st = null; return; } // vertical scroll
        if (dx > 14 && dx > Math.abs(dy) * 1.4) {
          st.active = true;
          shell.classList.add("chat-dragging");
          const m = main();
          if (m) m.style.transition = "none";
          try { document.activeElement?.blur?.(); } catch { /* ignore */ }
        } else if (dx < -14 && Math.abs(dx) > Math.abs(dy)) { st = null; return; } // leftwards = drawer
        else return;
      }
      if (e.cancelable) e.preventDefault();
      const now = Date.now();
      st.v = (t.clientX - st.lastX) / Math.max(1, now - st.lastT);
      st.lastX = t.clientX;
      st.lastT = now;
      setProgress(Math.max(0, dx), window.innerWidth);
    }

    function onEnd(e) {
      if (!st) return;
      const s = st;
      st = null;
      if (!s.active) return;
      const w = window.innerWidth;
      const dx = Math.max(0, (e.changedTouches?.[0]?.clientX ?? s.lastX) - s.x);
      const m = main();
      if (m) m.style.transition = "transform 240ms cubic-bezier(.22,1,.36,1)";
      shell.style.transition = "";
      if (dx > w * 0.34 || s.v > 0.55) {
        try { navigator.vibrate?.(8); } catch { /* ignore */ }
        setProgress(w, w);
        timer = setTimeout(() => {
          back.current();
          timer = setTimeout(cleanup, 140);
        }, 230);
      } else {
        setProgress(0, w);
        timer = setTimeout(cleanup, 250);
      }
    }
    const onCancel = (e) => onEnd(e);

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
      clearTimeout(timer);
      cleanup();
    };
  }, [enabled, shellRef]);
}
