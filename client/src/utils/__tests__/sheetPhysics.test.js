import test from "node:test";
import assert from "node:assert/strict";
import {
  SPRING_CRITICAL, SPRING_DEFAULT, VelocityTracker, buildSnapPoints, clampWithResistance, decayStep,
  decideConsumer, heightForState, isSettled, resolveSnap, rubberBand, stepSpring,
} from "../sheetPhysics.js";

const pts = [{ id: "hidden", height: 0 }, { id: "collapsed", height: 100 }, { id: "half", height: 400 }, { id: "expanded", height: 800 }];

function simulate(from, to, v0, cfg) {
  let s = { x: from, v: v0 }, t = 0, peak = from;
  while (!isSettled(s.x, s.v, to) && t < 5) { s = stepSpring(s, to, 1 / 60, cfg); t += 1 / 60; peak = Math.max(peak, s.x); }
  return { t, peak, s };
}

test("spring settles on target within ~0.6s at 60fps", () => {
  const r = simulate(0, 400, 0, SPRING_DEFAULT);
  assert.ok(r.t < 0.7, `took ${r.t}`);
});
test("default spring overshoots slightly, critical spring does not", () => {
  assert.ok(simulate(0, 400, 0, SPRING_DEFAULT).peak > 400.5);
  assert.ok(simulate(0, 400, 0, SPRING_CRITICAL).peak <= 400.5);
});
test("spring is frame-rate independent (30 vs 120 fps agree)", () => {
  const run = (fps) => { let s = { x: 0, v: 0 }; for (let i = 0; i < fps * 0.25; i++) s = stepSpring(s, 400, 1 / fps, SPRING_DEFAULT); return s.x; };
  assert.ok(Math.abs(run(30) - run(120)) < 1.5);
});
test("a huge dt (backgrounded tab) stays finite", () => {
  const s = stepSpring({ x: 0, v: 0 }, 400, 30, SPRING_DEFAULT);
  assert.ok(Number.isFinite(s.x) && Math.abs(s.x) < 1000);
});
test("release velocity carries into the spring (flick travels further than rest)", () => {
  assert.ok(simulate(300, 400, 2000, SPRING_DEFAULT).peak > simulate(300, 400, 0, SPRING_DEFAULT).peak);
});

test("rubber band is monotonic and bounded by the dimension", () => {
  assert.equal(rubberBand(0, 800), 0);
  assert.ok(rubberBand(50, 800) < 50 && rubberBand(500, 800) > rubberBand(50, 800) && rubberBand(1e6, 800) < 800);
});
test("clampWithResistance: free inside, resisted outside, hard stop when softMax=false", () => {
  assert.equal(clampWithResistance(300, 0, 800, 800), 300);
  assert.ok(clampWithResistance(900, 0, 800, 800) > 800 && clampWithResistance(900, 0, 800, 800) < 900);
  assert.equal(clampWithResistance(900, 0, 800, 800, false), 800);
  assert.ok(clampWithResistance(-60, 0, 800, 800) < 0);
});

test("snap: slow release goes to nearest point", () => {
  assert.equal(resolveSnap(380, 0, pts).id, "half");
  assert.equal(resolveSnap(620, 0, pts).id, "expanded");
  assert.equal(resolveSnap(40, 0, pts).id, "hidden");
  assert.equal(resolveSnap(70, 0, pts).id, "collapsed");
});
test("snap: momentum projects past the nearest point", () => {
  assert.equal(resolveSnap(560, 500, pts).id, "expanded"); // 560 + 80 = 640 → expanded
  assert.equal(resolveSnap(440, -500, pts).id, "half"); // 440 - 80 = 360 → half
});
test("snap: fast fling moves at least one point in its direction, never back", () => {
  assert.equal(resolveSnap(380, 900, pts).id, "half");       // half is still ahead of 380
  assert.equal(resolveSnap(420, 900, pts).id, "expanded");   // past half: next one up
  assert.equal(resolveSnap(300, 900, pts).id, "half");       // next point up, not collapsed
  assert.equal(resolveSnap(300, 4000, pts).id, "expanded");  // enough energy to skip
  assert.equal(resolveSnap(790, -900, pts).id, "half");      // one step down, not hidden
  assert.equal(resolveSnap(790, -6000, pts).id, "hidden");   // violent fling dismisses
  assert.equal(resolveSnap(800, 3000, pts).id, "expanded");  // already at the end
});
test("snap: without 'hidden' a fling down stops at collapsed", () => {
  assert.equal(resolveSnap(200, -6000, pts.slice(1)).id, "collapsed");
});

test("nested scroll: sheet grows first, then content scrolls", () => {
  assert.equal(decideConsumer(10, 400, 800, false), "sheet");
  assert.equal(decideConsumer(10, 800, 800, false), "content");
});
test("nested scroll: collapsing waits for the content to reach its edge", () => {
  assert.equal(decideConsumer(-10, 800, 800, false), "content");
  assert.equal(decideConsumer(-10, 800, 800, true), "sheet");
  assert.equal(decideConsumer(0, 800, 800, true), "none");
});

test("velocity tracker: steady 1px/ms → ~1000px/s; stale or single sample → 0", () => {
  const t = new VelocityTracker();
  for (let i = 0; i <= 8; i++) t.add(i * 16, i * 16);
  assert.ok(Math.abs(t.velocity(128) - 1000) < 30);
  assert.equal(t.velocity(128 + 200), 0); // finger rested before lifting
  const one = new VelocityTracker(); one.add(5, 5);
  assert.equal(one.velocity(6), 0);
});
test("velocity tracker ignores samples older than the window", () => {
  const t = new VelocityTracker(100);
  t.add(0, 0); t.add(500, 50); // old fast burst
  for (let i = 0; i < 8; i++) t.add(500 + i, 300 + i * 16); // then nearly still
  assert.ok(Math.abs(t.velocity(300 + 7 * 16)) < 100);
});

test("content fling decays to a stop", () => {
  let v = 2000, total = 0, n = 0;
  while (v && n++ < 600) { const r = decayStep(v, 1 / 60); v = r.velocity; total += r.delta; }
  assert.ok(n < 600 && total > 100 && total < 1000, `n=${n} total=${total}`);
});

test("buildSnapPoints: dedupes coinciding heights, respects dismissible", () => {
  const base = { height: 300, viewportHeight: 800, collapsedHeight: 96, halfRatio: 0.5 };
  // half (400) is clamped to H (300) and coincides with expanded → single point named expanded
  const p = buildSnapPoints({ ...base, states: ["hidden", "collapsed", "half", "expanded"], dismissible: true });
  assert.deepEqual(p.map((x) => x.id), ["hidden", "collapsed", "expanded"]);
  const q = buildSnapPoints({ ...base, states: ["hidden", "expanded"], dismissible: false });
  assert.deepEqual(q.map((x) => x.id), ["expanded"]);
});
test("heightForState falls back to the closest available state", () => {
  const p = buildSnapPoints({ height: 700, viewportHeight: 800, states: ["hidden", "expanded"], collapsedHeight: 96, halfRatio: 0.5, dismissible: true });
  assert.equal(heightForState(p, "half"), 700);
  assert.equal(heightForState(p, "hidden"), 0);
});
