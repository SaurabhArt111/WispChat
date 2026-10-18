import { useEffect, useRef } from "react";

const SWIPE_TRIGGER = 56; // px dragged right before a reply is armed
const SWIPE_MAX = 84;
const LONG_PRESS_MS = 420;
// Things inside a bubble that keep their own touch behaviour.
const IGNORE = "video, audio, input, textarea, [data-no-swipe], .code-block-container, .bubble-react-trigger, .bubble-forward-trigger";

/**
 * Touch gestures for one message row (WhatsApp-style):
 *   • drag a message to the RIGHT → a reply arrow pops in; let go past the
 *     threshold to reply (the bubble springs back)
 *   • press and hold → start selecting (with the reaction row + action bar)
 *
 * All motion is written straight to the element (CSS variable `--swipe-x`),
 * never through React state, so dragging stays at 60fps in long chats.
 * Returns `lastLongPressAt` so the tap that ends a long-press isn't also
 * treated as "toggle selection".
 */
export default function useBubbleGestures({ el, enabled, onReply, onLongPress }) {
  const cbRef = useRef({});
  cbRef.current = { onReply, onLongPress };
  const lastLongPressAt = useRef(0);
  const lastTouchAt = useRef(0);

  useEffect(() => {
    if (!el) return undefined;
    let st = null;
    let timer = null;
    let resetTimer = null;

    const setX = (x) => el.style.setProperty("--swipe-x", `${x}px`);
    const clearTimer = () => {
      clearTimeout(timer);
      timer = null;
    };
    const finishVisuals = () => {
      el.classList.remove("swiping", "swipe-armed");
      el.classList.add("swipe-return");
      setX(0);
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => el.classList.remove("swipe-return"), 240);
    };

    function onStart(e) {
      lastTouchAt.current = Date.now();
      st = null;
      clearTimer();
      if (e.touches.length !== 1) return;
      if (e.target instanceof Element && e.target.closest(IGNORE)) return;
      const t = e.touches[0];
      st = { x: t.clientX, y: t.clientY, axis: null, armed: false, fired: false };
      if (cbRef.current.onLongPress) {
        timer = setTimeout(() => {
          if (!st || st.axis) return;
          st.fired = true;
          lastLongPressAt.current = Date.now();
          try { navigator.vibrate?.(14); } catch { /* ignore */ }
          cbRef.current.onLongPress({ x: st.x, y: st.y });
        }, LONG_PRESS_MS);
      }
    }

    function onMove(e) {
      if (!st || st.fired) return;
      const t = e.touches[0];
      const dx = t.clientX - st.x;
      const dy = t.clientY - st.y;
      if (!st.axis) {
        if (Math.hypot(dx, dy) < 8) return;
        clearTimer();
        st.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
        if (st.axis === "x" && dx > 0 && cbRef.current.onReply) {
          el.classList.remove("swipe-return");
          el.classList.add("swiping");
        }
      }
      if (st.axis !== "x" || dx <= 0 || !cbRef.current.onReply) return;
      if (e.cancelable) e.preventDefault();
      const x = dx < SWIPE_TRIGGER ? dx : Math.min(SWIPE_MAX, SWIPE_TRIGGER + (dx - SWIPE_TRIGGER) * 0.25);
      setX(x);
      const armed = x >= SWIPE_TRIGGER;
      if (armed !== st.armed) {
        st.armed = armed;
        el.classList.toggle("swipe-armed", armed);
        if (armed) {
          try { navigator.vibrate?.(8); } catch { /* ignore */ }
        }
      }
    }

    function onEnd() {
      clearTimer();
      const s = st;
      st = null;
      if (!s) return;
      if (s.axis === "x" && el.classList.contains("swiping")) {
        if (s.armed) cbRef.current.onReply?.();
        finishVisuals();
      }
    }

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      clearTimer();
      clearTimeout(resetTimer);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.classList.remove("swiping", "swipe-armed", "swipe-return");
      el.style.removeProperty("--swipe-x");
    };
  }, [el, enabled]);

  return { lastLongPressAt, lastTouchAt };
}
