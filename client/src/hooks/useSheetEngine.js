import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  SPRING_CRITICAL,
  SPRING_DEFAULT,
  VelocityTracker,
  clampWithResistance,
  decayStep,
  decideConsumer,
  isSettled,
  stepSpring,
} from "../utils/sheetPhysics";

const SLOP = 6; // px of travel before a touch counts as a gesture
const NO_DRAG = 'input, textarea, select, [contenteditable="true"], [data-sheet-no-drag]';

function findScroller(target, stop) {
  for (let n = target; n && n !== stop; n = n.parentElement) {
    if (!(n instanceof HTMLElement)) continue;
    if (n.hasAttribute("data-sheet-scroll")) return n; // the sheet's own body
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 1) return n; // e.g. emoji list
  }
  return null;
}
const canScroll = (s) => s.scrollHeight > s.clientHeight + 1;
const atTop = (s) => s.scrollTop <= 0;
const atEnd = (s) => s.scrollTop + s.clientHeight >= s.scrollHeight - 1;

/**
 * Drives one sheet: renders its position straight to the DOM (no React state
 * per frame), animates it with a spring, and turns touch / mouse input into
 * drags with Android-style nested scrolling.
 *
 *   edge       "bottom" | "top"
 *   height     fully-expanded height in px (H)
 *   points     resting points [{ id, height }] (see buildSnapPoints)
 *   onRelease  ({ height, velocity }) – finger/mouse lifted after dragging the
 *              sheet; the owner decides where to settle (resolveSnap) and calls
 *              `animateTo`. `velocity` is positive when opening.
 */
export default function useSheetEngine({
  edge,
  height,
  enabled,
  reducedMotion,
  refs, // { root, sheet, panel, scroll }
  getPoints,
  onDragStateChange,
  onRelease,
}) {
  // Latest props, read from long-lived listeners.
  const live = useRef({});
  live.current = { edge, height, enabled, reducedMotion, getPoints, onDragStateChange, onRelease };

  const S = useMemo(
    () => ({ v: 0, raw: 0, vel: 0, target: 0, raf: 0, animating: false, dragging: false, done: null, frame: 0 }),
    []
  );
  const flingRaf = useRef(0);

  // ---- rendering ---------------------------------------------------------
  const paint = useCallback(() => {
    S.frame = 0;
    const { sheet, panel, root } = refs;
    const H = live.current.height;
    if (!sheet.current || !H) return;
    const v = S.v;
    const hidden = H - v;
    if (live.current.edge === "bottom") {
      sheet.current.style.transform = `translate3d(0,${hidden}px,0)`;
    } else {
      // Top sheets reveal like a shade: the box slides, the content stays pinned
      // to the top of the screen, and a clip shows only the revealed strip.
      sheet.current.style.transform = `translate3d(0,${-hidden}px,0)`;
      if (panel.current) panel.current.style.transform = `translate3d(0,${hidden}px,0)`;
      sheet.current.style.clipPath = `inset(${Math.max(0, hidden)}px -32px -56px -32px)`;
    }
    root.current?.style.setProperty("--wsheet-p", String(Math.min(1, Math.max(0, v / H))));
  }, [S, refs]);

  const schedulePaint = useCallback(() => {
    if (!S.frame) S.frame = requestAnimationFrame(paint);
  }, [S, paint]);

  const setMoving = (on) => refs.sheet.current?.classList.toggle("is-moving", on);

  // ---- spring ------------------------------------------------------------
  const stop = useCallback(() => {
    cancelAnimationFrame(S.raf);
    S.raf = 0;
    S.animating = false;
    setMoving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S]);

  const jumpTo = useCallback(
    (h) => {
      stop();
      S.v = S.raw = S.target = h;
      S.vel = 0;
      cancelAnimationFrame(S.frame);
      paint();
    },
    [S, stop, paint]
  );

  const animateTo = useCallback(
    (target, velocity = 0, done) => {
      stop();
      S.target = target;
      S.done = done || null;
      const H = live.current.height;
      if (!H || live.current.reducedMotion || Math.abs(target - S.v) < 0.5) {
        jumpTo(target);
        done?.();
        return;
      }
      // overshoot is natural when settling mid-way, wrong at the hard ends
      const spring = target <= 0.5 || target >= H - 0.5 ? SPRING_CRITICAL : SPRING_DEFAULT;
      S.animating = true;
      S.vel = velocity;
      setMoving(true);
      let last = performance.now();
      const tick = (now) => {
        const r = stepSpring({ x: S.v, v: S.vel }, target, (now - last) / 1000, spring);
        last = now;
        S.v = r.x;
        S.vel = r.v;
        if (target <= 0.5 && S.v < 0) { S.v = 0; S.vel = 0; }
        if (target >= H - 0.5 && S.v > H) { S.v = H; S.vel = 0; }
        S.raw = S.v;
        if (isSettled(S.v, S.vel, target)) {
          S.v = S.raw = target;
          S.vel = 0;
          S.animating = false;
          S.raf = 0;
          setMoving(false);
          paint();
          const cb = S.done;
          S.done = null;
          cb?.();
          return;
        }
        paint();
        S.raf = requestAnimationFrame(tick);
      };
      S.raf = requestAnimationFrame(tick);
    },
    [S, stop, jumpTo, paint]
  );

  useEffect(
    () => () => {
      cancelAnimationFrame(S.raf);
      cancelAnimationFrame(S.frame);
      cancelAnimationFrame(flingRaf.current);
    },
    [S]
  );

  // ---- gestures ----------------------------------------------------------
  useEffect(() => {
    const sheet = refs.sheet.current;
    if (!sheet) return undefined;
    const sign = () => (live.current.edge === "bottom" ? -1 : 1); // expandDelta = sign * fingerDeltaY
    let g = null; // active gesture

    const bounds = () => {
      const pts = live.current.getPoints();
      return { min: pts.length ? pts[0].height : 0, max: live.current.height };
    };

    function begin(kind, y, x, scroller, time) {
      const interrupted = S.animating;
      if (interrupted) stop();
      g = {
        kind, // "zone" (grip / header: always the sheet) | "content"
        scroller,
        x0: x,
        y0: y,
        lastY: y,
        axis: null,
        movedSheet: false,
        prevented: false,
        lastConsumer: null,
        interrupted,
        tracker: new VelocityTracker(),
      };
      g.tracker.add(y, time);
    }

    // returns true when the event default should be prevented
    function move(y, x, time, cancelable) {
      if (!g) return false;
      if (!g.axis) {
        const dx = x - g.x0;
        const dy = y - g.y0;
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return false;
        g.axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
      }
      if (g.axis === "x") return false; // horizontal swipes belong to whoever is under the finger
      const d = y - g.lastY;
      g.lastY = y;
      g.tracker.add(y, time);
      if (!d) return g.prevented;

      const H = live.current.height;
      const { min, max } = bounds();
      const e = sign() * d; // + = open further
      const s = g.scroller;
      const atEdge = !s || !canScroll(s) || (live.current.edge === "bottom" ? atTop(s) : atEnd(s));
      const who = g.kind === "zone" ? "sheet" : decideConsumer(e, S.raw, max, atEdge);
      g.lastConsumer = who;

      if (who === "sheet") {
        if (!g.movedSheet) {
          g.movedSheet = true;
          S.dragging = true;
          stop();
          live.current.onDragStateChange?.(true);
          setMoving(true);
        }
        let raw = S.raw + e;
        let overflow = 0;
        if (g.kind === "content" && raw > max) {
          overflow = raw - max; // the rest of this movement scrolls the content
          raw = max;
        }
        S.raw = raw;
        S.v = clampWithResistance(raw, min, max, H, g.kind === "zone");
        schedulePaint();
        if (overflow && s && g.prevented) s.scrollTop -= sign() * overflow;
        if (cancelable) {
          g.prevented = true;
          return true;
        }
        return g.prevented;
      }

      if (who === "content") {
        // Manual scroll only if we already cancelled native scrolling for this gesture.
        if (g.prevented && s) s.scrollTop -= d;
        return g.prevented;
      }
      return g.prevented;
    }

    function flingContent(scroller, velocity) {
      cancelAnimationFrame(flingRaf.current);
      let v = velocity;
      let last = performance.now();
      const tick = (now) => {
        const r = decayStep(v, Math.min(0.05, (now - last) / 1000));
        last = now;
        v = r.velocity;
        const before = scroller.scrollTop;
        scroller.scrollTop += r.delta;
        if (!v || scroller.scrollTop === before) return;
        flingRaf.current = requestAnimationFrame(tick);
      };
      flingRaf.current = requestAnimationFrame(tick);
    }

    function end(time) {
      const cur = g;
      g = null;
      if (!cur) return;
      const fingerV = cur.tracker.velocity(time);
      const sgn = sign();
      if (cur.movedSheet) {
        S.dragging = false;
        live.current.onDragStateChange?.(false);
        // A gesture that opened the sheet and kept going: carry the content scroll on.
        if (cur.prevented && cur.scroller && cur.lastConsumer === "content" && canScroll(cur.scroller)) {
          flingContent(cur.scroller, -fingerV);
        }
        live.current.onRelease?.({ height: S.v, velocity: sgn * fingerV });
        return;
      }
      if (cur.prevented && cur.scroller && cur.lastConsumer === "content") flingContent(cur.scroller, -fingerV);
      // A tap that merely interrupted a running spring: let it carry on.
      if (cur.interrupted) animateTo(S.target, S.vel, S.done);
    }

    // touch (non-passive so we can take over from native scrolling) ---------
    function onTouchStart(e) {
      cancelAnimationFrame(flingRaf.current);
      g = null;
      if (!live.current.enabled || e.touches.length !== 1) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const zone = !!target.closest("[data-sheet-drag]");
      if (!zone && target.closest(NO_DRAG)) return;
      const t = e.touches[0];
      begin(zone ? "zone" : "content", t.clientY, t.clientX, zone ? null : findScroller(target, sheet), e.timeStamp);
    }
    function onTouchMove(e) {
      if (!g || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (move(t.clientY, t.clientX, e.timeStamp, e.cancelable) && e.cancelable) e.preventDefault();
    }
    function onTouchEnd(e) {
      end(e.timeStamp);
    }

    // mouse / pen: only the grip and header drag (content text stays selectable)
    function onPointerDown(e) {
      if (e.pointerType === "touch" || e.button !== 0 || !live.current.enabled) return;
      const target = e.target;
      if (!(target instanceof Element) || !target.closest("[data-sheet-drag]") || target.closest(NO_DRAG)) return;
      begin("zone", e.clientY, e.clientX, null, e.timeStamp);
      let dragged = false;
      const onMove = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        move(ev.clientY, ev.clientX, ev.timeStamp, false);
        if (g?.movedSheet && !dragged) {
          dragged = true;
          try { sheet.setPointerCapture(e.pointerId); } catch { /* ignore */ }
          document.documentElement.classList.add("wsheet-dragging");
        }
      };
      const onUp = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        document.documentElement.classList.remove("wsheet-dragging");
        try { sheet.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        if (dragged) {
          // a drag must not also "click" the button it started on
          const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
          window.addEventListener("click", swallow, { capture: true, once: true });
          setTimeout(() => window.removeEventListener("click", swallow, true), 0);
        }
        end(ev.timeStamp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    }

    sheet.addEventListener("touchstart", onTouchStart, { passive: true });
    sheet.addEventListener("touchmove", onTouchMove, { passive: false });
    sheet.addEventListener("touchend", onTouchEnd, { passive: true });
    sheet.addEventListener("touchcancel", onTouchEnd, { passive: true });
    sheet.addEventListener("pointerdown", onPointerDown);
    return () => {
      sheet.removeEventListener("touchstart", onTouchStart);
      sheet.removeEventListener("touchmove", onTouchMove);
      sheet.removeEventListener("touchend", onTouchEnd);
      sheet.removeEventListener("touchcancel", onTouchEnd);
      sheet.removeEventListener("pointerdown", onPointerDown);
      document.documentElement.classList.remove("wsheet-dragging");
    };
    // listeners are bound once per mounted sheet element; live values come from `live`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S, refs, stop, animateTo, schedulePaint]);

  // Stable identity: callers put the engine in effect deps (history/Esc registration).
  return useMemo(
    () => ({
      animateTo,
      jumpTo,
      getHeight: () => S.v,
      getTarget: () => S.target,
      isBusy: () => S.animating || S.dragging,
      getVelocity: () => S.vel,
    }),
    [animateTo, jumpTo, S]
  );
}
