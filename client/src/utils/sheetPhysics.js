// ---------------------------------------------------------------------------
// Pure helpers behind TopSheet / BottomSheet: spring integration, velocity
// tracking, rubber-banding, snap resolution and the nested-scroll arbiter.
// No DOM, no React — everything here is unit-tested in __tests__/.
//
// Coordinate model: a sheet's position is its VISIBLE HEIGHT in px along the
// axis it opens on (0 = hidden, H = fully expanded), for both edges. "Expand
// velocity" is therefore positive when the sheet is being opened further.
// ---------------------------------------------------------------------------

export const SHEET_STATES = ["hidden", "collapsed", "half", "expanded"];

/** Slightly under-damped (ζ≈0.8): settles with a hint of overshoot. */
export const SPRING_DEFAULT = { stiffness: 400, damping: 32, mass: 1 };
/** Critically damped (ζ=1): no overshoot — used for dismiss and for "expanded". */
export const SPRING_CRITICAL = { stiffness: 400, damping: 40, mass: 1 };

export const FLING_VELOCITY = 650; // px/s — above this a release "flings" to the next snap
export const PROJECTION_SECONDS = 0.16; // how far ahead momentum is projected
const SUBSTEP = 1 / 240;

/** Advance a damped spring by `dt` seconds (fixed sub-steps → stable at any frame rate). */
export function stepSpring(state, target, dt, cfg = SPRING_DEFAULT) {
  const { stiffness, damping, mass = 1 } = cfg;
  let { x, v } = state;
  let t = Math.min(Math.max(dt, 0), 0.05); // a backgrounded tab must not explode the integrator
  while (t > 1e-9) {
    const h = Math.min(SUBSTEP, t);
    v += ((-stiffness * (x - target) - damping * v) / mass) * h;
    x += v * h;
    t -= h;
  }
  return { x, v };
}

export function isSettled(x, v, target, { pos = 0.35, vel = 8 } = {}) {
  return Math.abs(x - target) < pos && Math.abs(v) < vel;
}

/** iOS-style resistance: the further past the limit, the less the sheet follows. */
export function rubberBand(overshoot, dimension) {
  if (overshoot <= 0) return 0;
  const c = 0.55;
  return (1 - 1 / ((overshoot * c) / dimension + 1)) * dimension;
}

/**
 * Map a raw (unbounded) drag position to a displayed one. `softMax` = false
 * hard-stops at max (used when the content below takes over the extra motion).
 */
export function clampWithResistance(raw, min, max, dimension, softMax = true) {
  if (raw > max) return softMax ? max + rubberBand(raw - max, dimension) : max;
  if (raw < min) return min - rubberBand(min - raw, dimension);
  return raw;
}

/** Rolling-window velocity estimate (px/s) — robust to one jittery sample. */
export class VelocityTracker {
  constructor(windowMs = 100) {
    this.windowMs = windowMs;
    this.samples = [];
  }
  reset() {
    this.samples.length = 0;
  }
  add(pos, time) {
    this.samples.push({ pos, time });
    const cutoff = time - this.windowMs * 2;
    while (this.samples.length > 2 && this.samples[0].time < cutoff) this.samples.shift();
  }
  /** `now` = release time: a finger that rested before lifting has no velocity. */
  velocity(now) {
    const s = this.samples;
    if (s.length < 2) return 0;
    const last = s[s.length - 1];
    if (now - last.time > 80) return 0;
    let first = last;
    for (let i = s.length - 2; i >= 0; i--) {
      if (last.time - s[i].time > this.windowMs) break;
      first = s[i];
    }
    const dt = last.time - first.time;
    if (dt <= 0) return 0;
    return ((last.pos - first.pos) / dt) * 1000;
  }
}

/**
 * Pick the snap point to settle on.
 *  - slow release  → nearest point to where momentum would carry the sheet
 *  - fast fling    → the next point in the fling direction (further if the
 *                    projected travel reaches it), never back where it came from
 * `points` = [{ id, height }], any order. Returns one of them.
 */
export function resolveSnap(position, velocity, points) {
  if (!points.length) return null;
  const sorted = [...points].sort((a, b) => a.height - b.height);
  const projected = position + velocity * PROJECTION_SECONDS;
  let pool = sorted;
  if (Math.abs(velocity) >= FLING_VELOCITY) {
    const up = velocity > 0;
    const ahead = sorted.filter((p) => (up ? p.height > position + 1 : p.height < position - 1));
    if (!ahead.length) return up ? sorted[sorted.length - 1] : sorted[0];
    pool = ahead;
  }
  let best = pool[0];
  for (const p of pool) if (Math.abs(p.height - projected) < Math.abs(best.height - projected)) best = p;
  return best;
}

/**
 * Android-style nested-scroll arbiter: who consumes this slice of finger
 * movement — the sheet or the scrollable content inside it?
 *
 *   expandDelta        finger movement in the "open the sheet further" direction (+)
 *   height / maxHeight current visible height / fully-expanded height
 *   contentAtCollapseEdge  content cannot scroll any further toward the
 *                          collapse side (bottom sheet: scrolled to top;
 *                          top sheet: scrolled to the end) or isn't scrollable
 *
 *   • opening: the sheet grows first; once fully open the content scrolls.
 *   • closing: the content scrolls back to its edge first; only then does the
 *     sheet start to collapse.
 */
export function decideConsumer(expandDelta, height, maxHeight, contentAtCollapseEdge) {
  if (expandDelta > 0) return height < maxHeight - 0.5 ? "sheet" : "content";
  if (expandDelta < 0) return contentAtCollapseEdge ? "sheet" : "content";
  return "none";
}

/** Exponential decay used to carry a manual content scroll after release. */
export function decayStep(velocity, dt, friction = 4.2) {
  const v = velocity * Math.exp(-friction * dt);
  return { velocity: Math.abs(v) < 18 ? 0 : v, delta: ((velocity + v) / 2) * dt };
}

/** Build the ordered list of resting points for the enabled states. */
export function buildSnapPoints({ height, viewportHeight, states, collapsedHeight, halfRatio, dismissible }) {
  const heights = {
    hidden: 0,
    collapsed: Math.min(Math.max(collapsedHeight, 0), height),
    half: Math.min(height, Math.round(viewportHeight * halfRatio)),
    expanded: height,
  };
  const out = [];
  for (const id of states) {
    if (!(id in heights)) continue;
    if (id === "hidden" && !dismissible) continue;
    const h = heights[id];
    const dup = out.find((p) => Math.abs(p.height - h) < 1);
    if (dup) {
      if (id === "expanded") dup.id = "expanded"; // coinciding points keep the "bigger" name
      continue;
    }
    out.push({ id, height: h });
  }
  return out.sort((a, b) => a.height - b.height);
}

export function heightForState(points, id, fallback = 0) {
  const exact = points.find((p) => p.id === id);
  if (exact) return exact.height;
  // requested state isn't available (or coincides with another): use the closest by rank
  const rank = SHEET_STATES.indexOf(id);
  let best = null;
  for (const p of points) {
    const d = Math.abs(SHEET_STATES.indexOf(p.id) - rank);
    if (!best || d < best.d) best = { d, h: p.height };
  }
  return best ? best.h : fallback;
}
