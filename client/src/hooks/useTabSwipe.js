import { useEffect, useRef } from "react";

// Anything that keeps its own horizontal gestures / text handling.
const BLOCK =
  'input, textarea, select, video, audio, canvas, [contenteditable="true"], [data-no-swipe], ' +
  ".mobile-drawer, .emoji-popover, .ctx-menu, .context-menu, .post-sheet-overlay, .media-composer";
const OVERLAY = '[role="dialog"], .modal, .modal-backdrop, .modal-overlay, .lightbox, .status-viewer-overlay, .call-overlay, .react-sheet-backdrop';
const EDGE = 28;
export const TAB_GAP = 14; // px between two pages while they slide

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
 * Live page-to-page swiping between the main tabs (Chats · Status · Explore ·
 * Calls · Profile), like WhatsApp: the page you're on follows your finger and
 * the NEXT page slides in right beside it. Let go past a third of the screen
 * (or flick) and it settles into place; otherwise it springs back.
 *
 * Motion is written to a CSS variable on the shell (`--tab-dx`) straight from
 * the touch handler — no React state per frame.
 *
 *   order        tab ids, left → right
 *   current      id of the tab on screen
 *   canPeek(id)  can that tab be rendered side-by-side (a panel) or not (a full page)?
 *   onPeek(p)    {id, side: 1 | -1} while a neighbour should be rendered, null otherwise
 *   onCommit(id) navigate to that tab (called once the slide has settled)
 */
export default function useTabSwipe({ enabled, shellRef, order, current, canPeek, onPeek, onCommit }) {
  const live = useRef({});
  live.current = { order, current, canPeek, onPeek, onCommit };

  useEffect(() => {
    if (!enabled) return undefined;
    const shell = shellRef.current;
    if (!shell) return undefined;
    let st = null;
    let settleTimer = null;
    let peekedId = null;

    const setDx = (dx) => shell.style.setProperty("--tab-dx", `${dx}px`);
    const reset = () => {
      shell.classList.remove("tab-dragging", "tab-settling");
      shell.style.removeProperty("--tab-dx");
      if (peekedId) live.current.onPeek(null);
      peekedId = null;
    };

    function neighbour(dir) {
      const { order: o, current: c } = live.current;
      const i = o.indexOf(c);
      if (i < 0) return null;
      return o[i + dir] ?? null;
    }

    function onStart(e) {
      if (st?.settling) return;
      st = null;
      if (e.touches.length !== 1) return;
      if (document.querySelector(OVERLAY)) return;
      const t = e.touches[0];
      const el = e.target;
      if (!(el instanceof Element) || !el.closest(".app-shell")) return;
      if (el.closest(BLOCK)) return;
      const atEdge = t.clientX < EDGE || t.clientX > window.innerWidth - EDGE;
      // Chat rows have their own swipe actions — only the screen edge may start a page swipe on them.
      if (el.closest(".conv-swipe-wrap") && !atEdge) return;
      if (inHScroller(el)) return;
      if (live.current.order.indexOf(live.current.current) < 0) return;
      st = { x: t.clientX, y: t.clientY, t: Date.now(), lastX: t.clientX, lastT: Date.now(), v: 0, axis: null, dir: 0, nb: null, follow: false };
    }

    function onMove(e) {
      if (!st || st.settling) return;
      const t = e.touches[0];
      const dx = t.clientX - st.x;
      const dy = t.clientY - st.y;
      if (!st.axis) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { st = null; return; } // vertical scroll
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
        st.axis = "x";
        try { document.activeElement?.blur?.(); } catch { /* ignore */ }
      }
      const dir = dx < 0 ? 1 : -1; // +1 = going to the tab on the right
      if (dir !== st.dir) {
        st.dir = dir;
        st.nb = neighbour(dir);
        st.follow = !st.nb || live.current.canPeek(st.nb);
        if (st.follow) {
          shell.classList.add("tab-dragging");
          if (st.nb) {
            peekedId = st.nb;
            live.current.onPeek({ id: st.nb, side: dir });
          } else if (peekedId) {
            live.current.onPeek(null);
            peekedId = null;
          }
        }
      }
      if (!st.follow) return; // neighbour is a full page → handled on release
      if (e.cancelable) e.preventDefault();
      const w = window.innerWidth;
      const now = Date.now();
      st.v = (t.clientX - st.lastX) / Math.max(1, now - st.lastT);
      st.lastX = t.clientX;
      st.lastT = now;
      // Nothing beyond the first/last tab: rubber-band.
      setDx(st.nb ? Math.max(-w, Math.min(w, dx)) : dx * 0.28);
    }

    function onEnd(e) {
      if (!st || st.settling) return;
      const s = st;
      if (!s.axis) { st = null; return; }
      const w = window.innerWidth;
      const endX = e.changedTouches?.[0]?.clientX ?? s.lastX;
      const dx = endX - s.x;
      const quick = Date.now() - s.t < 700;
      const goes = !!s.nb && ((s.dir === 1 ? dx < 0 : dx > 0) && (Math.abs(dx) > w * 0.33 || (Math.abs(s.v) > 0.5 && Math.abs(dx) > 40) || (!s.follow && quick && Math.abs(dx) > 72)));

      if (!s.follow) {
        // Neighbour is a full page (e.g. Profile): no live drag, just switch.
        st = null;
        if (goes) {
          try { navigator.vibrate?.(6); } catch { /* ignore */ }
          live.current.onCommit(s.nb, { live: false });
        }
        return;
      }

      s.settling = true;
      shell.classList.add("tab-settling");
      if (goes) {
        try { navigator.vibrate?.(6); } catch { /* ignore */ }
        setDx(-s.dir * (w + TAB_GAP));
        settleTimer = setTimeout(() => {
          st = null;
          live.current.onCommit(s.nb, { live: true });
          // Remove the helper layer in the same tick the route changes.
          reset();
        }, 290);
      } else {
        setDx(0);
        settleTimer = setTimeout(() => {
          st = null;
          reset();
        }, 285);
      }
    }

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
      clearTimeout(settleTimer);
      st = null;
      reset();
    };
  }, [enabled, shellRef]);
}
