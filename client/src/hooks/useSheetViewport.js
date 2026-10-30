import { useEffect, useLayoutEffect, useState } from "react";

function readSafeTop() {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)";
  document.body.appendChild(probe);
  const v = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return v;
}

function read() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const innerH = typeof window !== "undefined" ? window.innerHeight : 800;
  const vh = vv ? vv.height : innerH;
  // On-screen keyboard: Chrome/Android (resizes-visual) and iOS shrink only the
  // VISUAL viewport, so the gap to the layout viewport is the keyboard.
  const kb = vv ? Math.max(0, Math.round(innerH - vv.height - vv.offsetTop)) : 0;
  return { vh: Math.round(vh), kb, safeTop: Math.round(readSafeTop()) };
}

/**
 * What a sheet needs to know about the screen: usable height, the soft
 * keyboard's height (so a bottom sheet rides above it) and the top safe-area
 * inset (notch / status bar). Recomputed on resize, rotation and keyboard.
 */
export default function useSheetViewport(active = true) {
  const [m, setM] = useState(read);
  useLayoutEffect(() => {
    if (active) setM(read());
  }, [active]);
  useEffect(() => {
    if (!active) return undefined;
    const update = () => setM((prev) => {
      const n = read();
      return n.vh === prev.vh && n.kb === prev.kb && n.safeTop === prev.safeTop ? prev : n;
    });
    const vv = window.visualViewport;
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
    };
  }, [active]);
  return m;
}
