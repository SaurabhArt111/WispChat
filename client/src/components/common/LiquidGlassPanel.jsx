import { useEffect, useRef } from "react";

/**
 * Wraps `children` in a true WebGL "liquid glass" panel (refraction,
 * chromatic aberration, Fresnel reflection, specular highlights) rendered
 * by @ybouane/liquidglass, floating above a decorative animated backdrop.
 *
 * This is purely additive/decorative: if WebGL2 isn't available, the user
 * has requested reduced motion, or the library fails to load for any
 * reason, we silently fall back to the plain CSS glass look the element
 * already has via `--surface-glass` — nothing about the surrounding app
 * breaks or depends on this effect succeeding.
 */
export default function LiquidGlassPanel({
  as: Tag = "div",
  className = "",
  panelClassName = "",
  config,
  children,
  ...rest
}) {
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const backdropRef = useRef(null);
  const instanceRef = useRef(null);

  // Paints a slow-drifting brand-colored gradient onto the decorative
  // backdrop canvas behind the glass panel, so the shader has something
  // real to refract even though there's no photo background. Cleaned up
  // on unmount so the rAF loop never outlives the component.
  useEffect(() => {
    const canvas = backdropRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    let t = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth || 1;
      canvas.height = parent.clientHeight || 1;
    };
    resize();
    window.addEventListener("resize", resize);

    function paint() {
      t += 0.0035;
      const w = canvas.width;
      const h = canvas.height;
      if (w && h && ctx) {
        const cx = w * (0.5 + 0.3 * Math.sin(t));
        const cy = h * (0.5 + 0.3 * Math.cos(t * 0.8));
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.8);
        g.addColorStop(0, "rgba(94, 242, 192, 0.35)");
        g.addColorStop(0.5, "rgba(56, 189, 248, 0.18)");
        g.addColorStop(1, "rgba(11, 14, 18, 0)");
        ctx.fillStyle = "#0b0e12";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      raf = requestAnimationFrame(paint);
    }
    paint();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    function supportsWebGL2() {
      try {
        const c = document.createElement("canvas");
        return !!c.getContext("webgl2");
      } catch {
        return false;
      }
    }

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion || !supportsWebGL2() || !rootRef.current || !panelRef.current) {
      return;
    }

    if (config) {
      panelRef.current.dataset.config = JSON.stringify(config);
    }

    import("@ybouane/liquidglass")
      .then(({ LiquidGlass }) =>
        LiquidGlass.init({
          root: rootRef.current,
          glassElements: [panelRef.current],
        })
      )
      .then((instance) => {
        if (cancelled) {
          instance.destroy();
          return;
        }
        instanceRef.current = instance;
        rootRef.current?.classList.add("lg-active");
      })
      .catch(() => {
        // Library failed to initialize (unsupported context, blocked CDN,
        // etc). The panel keeps its plain CSS glass fallback styling.
      });

    return () => {
      cancelled = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Tag ref={rootRef} className={`lg-root ${className}`} {...rest}>
      <canvas className="lg-backdrop" data-dynamic aria-hidden="true" ref={backdropRef} />
      <div ref={panelRef} className={`lg-panel ${panelClassName}`}>
        {children}
      </div>
    </Tag>
  );
}
