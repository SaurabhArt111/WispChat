import { useCallback, useRef } from "react";

/**
 * Double-tap / double-click detector that behaves the same for touch, pen
 * and mouse (the native `dblclick` event is unreliable on touch screens,
 * which is why double-tap-to-like used to do nothing on phones).
 *
 * Returns pointer handlers to spread on the element. `onDouble(point)` gets
 * the position of the second tap so the heart can burst where you tapped.
 * `onSingle` (optional) fires only once it's clear no second tap followed.
 */
export default function useDoubleTap({ onDouble, onSingle, delay = 280 } = {}) {
  const last = useRef({ t: 0, x: 0, y: 0 });
  const singleTimer = useRef(null);
  const down = useRef(null);

  const onPointerDown = useCallback((e) => {
    down.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }, []);

  const onPointerUp = useCallback(
    (e) => {
      const start = down.current;
      down.current = null;
      // Ignore drags/scrolls and long presses.
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10 || Date.now() - start.t > 400) return;
      if (e.target.closest?.("button, a, input, textarea, [data-no-tap]")) return;

      const now = Date.now();
      const prev = last.current;
      if (now - prev.t < delay && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 40) {
        clearTimeout(singleTimer.current);
        last.current = { t: 0, x: 0, y: 0 };
        const rect = e.currentTarget.getBoundingClientRect();
        onDouble?.({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        last.current = { t: now, x: e.clientX, y: e.clientY };
        if (onSingle) {
          clearTimeout(singleTimer.current);
          singleTimer.current = setTimeout(() => onSingle(), delay);
        }
      }
    },
    [onDouble, onSingle, delay]
  );

  return { onPointerDown, onPointerUp };
}
