import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useMediaQuery from "../../../hooks/useMediaQuery";
import useSheetEngine from "../../../hooks/useSheetEngine";
import useSheetViewport from "../../../hooks/useSheetViewport";
import { buildSnapPoints, heightForState, resolveSnap } from "../../../utils/sheetPhysics";
import { nextSheetId, registerSheet } from "../../../utils/sheetStack";
import "../../../styles/sheets.css";

const STATE_LABEL = { hidden: "Closed", collapsed: "Collapsed", half: "Half expanded", expanded: "Fully expanded" };
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const TOP_GAP = 12; // breathing room between an expanded sheet and the screen edge

// Not offsetParent: that is null for position:fixed descendants (and in test DOMs).
function isTabbable(n) {
  if (n.closest("[hidden], [inert]")) return false;
  const cs = getComputedStyle(n);
  return cs.display !== "none" && cs.visibility !== "hidden";
}

let openModals = 0; // for the <html> class that stops background overscroll

/**
 * Draggable sheet that opens from the bottom or the top edge. Use through
 * <BottomSheet> / <TopSheet>.
 *
 * States: "hidden" · "collapsed" (peek) · "half" · "expanded". Drag the grip or
 * header (touch or mouse), or drag the content: it scrolls like Android's
 * nested scrolling — a sheet that isn't fully open grows first, a fully open
 * one scrolls its content, and pulling down at the top of the content closes it.
 *
 * Mount it conditionally (`{show && <BottomSheet onClose={…} />}`) like the
 * app's modals, or keep it mounted and drive `open`. Either way it animates out
 * before `onClose` fires.
 */
export default function Sheet({ open = true, ...props }) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  if (!mounted) return null;
  return <SheetView open={open} onExited={() => setMounted(false)} {...props} />;
}

function SheetView({
  edge = "bottom",
  open,
  onExited,
  onClose,
  state, // controlled resting state (optional)
  defaultState,
  onStateChange,
  snapStates,
  collapsedHeight = 96,
  halfRatio = 0.5,
  fit = false, // size to content (up to the screen) instead of filling it
  dismissible = true,
  modal = true,
  closeOnBackdrop = true,
  backDismiss, // default: modal sheets only
  title,
  labelledBy,
  header,
  footer,
  children,
  className = "",
  zIndex = 1300,
  initialFocus, // CSS selector inside the sheet; default = the sheet itself
  maxHeightRatio = 1,
  gripLabel,
}) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const vp = useSheetViewport(true);
  const id = useRef(null);
  if (!id.current) id.current = nextSheetId();
  const uid = useId();

  const rootRef = useRef(null);
  const sheetRef = useRef(null);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const refs = useMemo(() => ({ root: rootRef, sheet: sheetRef, panel: panelRef, scroll: scrollRef }), []);

  // ---- geometry ----------------------------------------------------------
  const maxH = Math.max(140, Math.floor((vp.vh - vp.safeTop - TOP_GAP) * maxHeightRatio));
  const [measured, setMeasured] = useState(0);
  useLayoutEffect(() => {
    if (!fit) return undefined;
    const el = sheetRef.current;
    const read = () => setMeasured(el.offsetHeight);
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);
  const H = fit ? Math.min(measured, maxH) : maxH;

  const states = snapStates || (fit ? ["hidden", "expanded"] : ["hidden", "collapsed", "half", "expanded"]);
  const points = useMemo(
    () => buildSnapPoints({ height: H, viewportHeight: vp.vh, states, collapsedHeight, halfRatio, dismissible }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [H, vp.vh, states.join(), collapsedHeight, halfRatio, dismissible]
  );
  const pointsRef = useRef(points);
  pointsRef.current = points;

  // ---- state -------------------------------------------------------------
  const startState = defaultState || (fit || !states.includes("half") ? "expanded" : "half");
  const [cur, setCur] = useState(startState);
  const effective = state ?? cur;
  const [phase, setPhase] = useState("open"); // "open" | "exiting"
  const [dragging, setDragging] = useState(false);
  const [announce, setAnnounce] = useState("");
  const closingRef = useRef(false);
  const live = useRef({});
  live.current = { onClose, onExited, onStateChange, dismissible, controlled: state !== undefined };

  const api = useRef(null);
  const engine = useSheetEngine({
    edge,
    height: H,
    enabled: phase === "open",
    reducedMotion: reduced,
    refs,
    getPoints: () => pointsRef.current,
    onDragStateChange: setDragging,
    onRelease: (r) => api.current.release(r),
  });

  const commit = useCallback((next) => {
    if (!live.current.controlled) setCur(next);
    live.current.onStateChange?.(next);
    setAnnounce(STATE_LABEL[next] || "");
  }, []);

  const beginClose = useCallback(
    (reason, velocity = 0) => {
      if (closingRef.current) return false;
      if (!live.current.dismissible && reason !== "prop") return false;
      closingRef.current = true;
      setPhase("exiting");
      engine.animateTo(0, velocity, () => {
        live.current.onExited?.();
        if (reason !== "prop") live.current.onClose?.(reason);
      });
      return true;
    },
    [engine]
  );

  api.current = {
    release: ({ height, velocity }) => {
      const pick = resolveSnap(height, velocity, pointsRef.current);
      if (!pick) return;
      if (pick.height <= 0) {
        beginClose("gesture", velocity);
        return;
      }
      commit(pick.id);
      engine.animateTo(pick.height, velocity);
    },
    close: beginClose,
  };

  // ---- enter / follow state & size changes -------------------------------
  const entered = useRef(false);
  useLayoutEffect(() => {
    if (!H || !points.length || closingRef.current || dragging) return;
    const target = heightForState(points, effective, H);
    if (!entered.current) {
      entered.current = true;
      engine.jumpTo(0);
      engine.animateTo(target, 0);
      return;
    }
    if (Math.abs(engine.getTarget() - target) < 0.5 && (engine.isBusy() || Math.abs(engine.getHeight() - target) < 0.5)) return;
    engine.animateTo(target, engine.getVelocity());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [H, points, effective]);

  // parent flips `open` (kept-mounted usage)
  useEffect(() => {
    if (!entered.current) return;
    if (!open) {
      beginClose("prop");
    } else if (closingRef.current) {
      closingRef.current = false; // re-opened mid-exit
      setPhase("open");
      engine.animateTo(heightForState(pointsRef.current, effective, H), engine.getVelocity());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---- Esc + Back button (topmost modal sheet only) ----------------------
  const wantsBack = backDismiss ?? modal;
  useEffect(() => {
    if (!open || !modal || !dismissible) return undefined;
    let unregister;
    // deferred a tick so React StrictMode's mount/unmount/mount pushes only one history entry
    const t = setTimeout(() => {
      unregister = registerSheet({ id: id.current, back: wantsBack, requestClose: (reason) => beginClose(reason) });
    }, 0);
    return () => {
      clearTimeout(t);
      unregister?.();
    };
  }, [open, modal, dismissible, wantsBack, beginClose]);

  // ---- focus, scroll lock -------------------------------------------------
  useEffect(() => {
    if (!modal) return undefined;
    const prev = document.activeElement;
    const el = sheetRef.current;
    const target = (initialFocus && el?.querySelector(initialFocus)) || el;
    target?.focus?.({ preventScroll: true });
    openModals += 1;
    document.documentElement.classList.add("wsheet-open");
    return () => {
      openModals -= 1;
      if (!openModals) document.documentElement.classList.remove("wsheet-open");
      if (prev && prev !== document.body && document.contains(prev)) prev.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal]);

  // ---- keyboard -----------------------------------------------------------
  function onSheetKeyDown(e) {
    if (e.key === "Escape" && !modal && dismissible) {
      e.stopPropagation();
      beginClose("escape");
      return;
    }
    if (e.key === "Tab" && modal) {
      const nodes = [...sheetRef.current.querySelectorAll(FOCUSABLE)].filter(isTabbable);
      if (!nodes.length) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === sheetRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  const visible = points.filter((p) => p.height > 0); // keyboard never "steps" into hidden — Esc closes
  function step(dir) {
    const i = visible.findIndex((p) => p.id === effective || Math.abs(p.height - engine.getTarget()) < 1);
    const next = visible[Math.min(visible.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))];
    if (next && next.id !== effective) commit(next.id);
    if (next) engine.animateTo(next.height, 0);
  }
  function onGripKeyDown(e) {
    const open1 = edge === "bottom" ? "ArrowUp" : "ArrowDown";
    const close1 = edge === "bottom" ? "ArrowDown" : "ArrowUp";
    if (e.key === open1) step(1);
    else if (e.key === close1) step(-1);
    else if (e.key === "Home") step(-99);
    else if (e.key === "End") step(99);
    else if (e.key === "Enter" || e.key === " ") {
      const top = visible[visible.length - 1];
      if (effective === top?.id) step(-1);
      else step(1);
    } else return;
    e.preventDefault();
  }

  // header / footer / children may be functions: ({ close, state }) => node, so
  // a button inside the sheet can close it WITH the exit animation.
  const slot = { close: () => beginClose("button"), state: effective };
  const render = (n) => (typeof n === "function" ? n(slot) : n);

  const pct = H ? Math.round((heightForState(points, effective, H) / H) * 100) : 0;
  const grip = (
    <div
      className="wsheet-grip"
      data-sheet-drag
      role="separator"
      aria-orientation="horizontal"
      aria-label={gripLabel || `${title || "Sheet"} size. Use arrow keys to resize`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      tabIndex={0}
      onKeyDown={onGripKeyDown}
    >
      <span className="wsheet-grip-bar" />
    </div>
  );

  const kbOpen = vp.kb > 80;
  const rootStyle = {
    zIndex,
    bottom: vp.kb,
    "--wsheet-max": `${maxH}px`,
    "--wsheet-p": 0,
  };

  return createPortal(
    // Portalled for the same reason as Modal: ancestors with transforms would
    // otherwise become the containing block for position:fixed.
    <div
      ref={rootRef}
      className={`wsheet-root ${modal ? "is-modal" : "is-inline"} ${dragging ? "is-dragging" : ""} ${H ? "" : "is-measuring"}`}
      style={rootStyle}
    >
      {modal && <div className="wsheet-backdrop" aria-hidden="true" onClick={() => closeOnBackdrop && beginClose("backdrop")} />}
      <div
        ref={sheetRef}
        className={`wsheet wsheet--${edge} ${fit ? "wsheet--fit" : "wsheet--tall"} ${kbOpen ? "kb-open" : ""} ${className}`}
        role="dialog"
        aria-modal={modal ? "true" : undefined}
        aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        data-no-swipe
        data-sheet-state={effective}
        onKeyDown={onSheetKeyDown}
      >
        <div ref={panelRef} className="wsheet-panel">
          {edge === "bottom" && grip}
          {header && (
            <div className="wsheet-header" data-sheet-drag>
              {render(header)}
            </div>
          )}
          <div ref={scrollRef} className="wsheet-scroll" data-sheet-scroll>
            <div className="wsheet-inner">{render(children)}</div>
          </div>
          {footer && <div className="wsheet-footer">{render(footer)}</div>}
        </div>
        {edge === "top" && grip}
      </div>
      <span id={`${uid}-live`} className="wsheet-live" role="status" aria-live="polite">
        {announce}
      </span>
    </div>,
    document.body
  );
}
