import { useEffect } from "react";

/**
 * Drives the collapsing profile header (big avatar → compact toolbar).
 *
 * Scroll position is turned into a single CSS variable, --p (0 = fully
 * expanded, 1 = fully collapsed), written straight onto the panel element
 * inside requestAnimationFrame — no React state, so scrolling never causes
 * re-renders and the animation stays on the compositor-friendly properties
 * (opacity/transform/height) the stylesheet derives from --p.
 */
export default function useCollapsingHero(panelRef, scrollRef, { min = 58, maxCap = 340 } = {}) {
  useEffect(() => {
    const panel = panelRef.current;
    const scroller = scrollRef.current;
    if (!panel || !scroller) return undefined;

    let raf = 0;
    let max = maxCap;

    const apply = () => {
      raf = 0;
      const range = Math.max(1, max - min);
      const p = Math.min(1, Math.max(0, scroller.scrollTop / range));
      panel.style.setProperty("--p", p.toFixed(3));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const measure = () => {
      max = Math.max(min + 80, Math.min(maxCap, panel.clientWidth || maxCap));
      panel.style.setProperty("--hero-max", `${max}px`);
      panel.style.setProperty("--hero-min", `${min}px`);
      apply();
    };

    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(panel);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [panelRef, scrollRef, min, maxCap]);
}
