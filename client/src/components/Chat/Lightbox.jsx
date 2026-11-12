import { isNative } from "../../native/wispNative";
import { nativeDownload } from "../../native/nativeMedia";
import { useToast } from "../../context/ToastContext";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, DownloadIcon, ForwardIcon, ExternalLinkIcon, CopyIcon, AlertIcon } from "../common/Icons";
import { copyImageToClipboard } from "../../utils/copyImage";
import { useDecryptedMediaUrl } from "../../hooks/useDecryptedMessage";
import { useContextMenu } from "../../context/ContextMenuContext";
import { QUICK_EMOJI } from "./QuickReactions";
import "../../styles/lightbox.css";

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const GAP = 28; // px of black between neighbouring photos while swiping
const SLIDE_MS = 280; // swipe settle
const CLOSE_MS = 200; // exit animation
const EASE = "cubic-bezier(.22,1,.36,1)";

// One photo/video in the strip. Each slide resolves (decrypts) its own media,
// so the neighbours are already ready by the time you swipe to them.
function LightboxSlide({ img, fallbackMessage, pos, active, zoom, pan, origin, dragging, imgRef, onDoubleClick, onActiveState }) {
  const { url, loading, error, errorCode, retry } = useDecryptedMediaUrl(img?._message || fallbackMessage, img);
  const [broken, setBroken] = useState(false); // <img>/<video> failed to load → treat as missing
  useEffect(() => setBroken(false), [url]);

  const isVideo = img?.kind === "video";
  const missing = broken || (error && errorCode === "missing");
  const problem = error && errorCode !== "missing";

  useEffect(() => {
    if (active) onActiveState({ url, loading, error: error || broken, missing, errorCode: broken ? "missing" : errorCode });
  }, [active, url, loading, error, broken, missing, errorCode, onActiveState]);

  const videoRef = useRef(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) v.play?.().catch(() => {});
    else v.pause?.();
  }, [active, url]);

  const style = active
    ? {
        transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
        transformOrigin: `${origin.x}% ${origin.y}%`,
        cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in",
        transition: dragging ? "none" : undefined,
      }
    : undefined;

  return (
    <div className={`lb-slide ${active ? "active" : ""}`} style={{ "--p": pos }} aria-hidden={!active}>
      {loading && <div className="lb-status">Decrypting…</div>}
      {problem && (
        <div className="lb-status lb-problem">
          <AlertIcon size={22} />
          <span>{errorCode === "locked" ? "Unlock encryption to view this" : errorCode === "network" ? "Couldn't load — connection problem" : "Couldn't decrypt this file"}</span>
          {(errorCode === "network" || errorCode === "locked") && (
            <button type="button" onClick={retry}>Retry</button>
          )}
        </div>
      )}
      {url && !missing && !isVideo && (
        <img
          ref={active ? imgRef : undefined}
          data-no-fallback
          src={url}
          alt={img.name || "Photo"}
          className="lb-media"
          draggable={false}
          onDoubleClick={active ? onDoubleClick : undefined}
          onError={() => setBroken(true)}
          style={style}
        />
      )}
      {url && !missing && isVideo && (
        <video
          ref={videoRef}
          data-no-fallback
          src={url}
          className="lb-media lb-video"
          controls={active}
          playsInline
          preload="metadata"
          onError={() => setBroken(true)}
        />
      )}
    </div>
  );
}

export default function Lightbox({
  message,
  images,
  startIndex = 0,
  userId,
  reactToMessage,
  onClose,
  onForward,
}) {
  const [index, setIndex] = useState(Math.max(0, Math.min(images.length - 1, startIndex)));
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const [flying, setFlying] = useState(false); // closing by swipe: the picture itself flies off, so skip the fade-out
  const [chromeHidden, setChromeHidden] = useState(false);
  const [active, setActive] = useState({ url: null, loading: true, error: false, missing: false, errorCode: null });

  const overlayRef = useRef(null);
  const stageRef = useRef(null);
  const trackRef = useRef(null);
  const backdropRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null); // pan while zoomed (mouse or one finger)
  const pinchRef = useRef(null);
  const gestureRef = useRef(null); // swipe / dismiss gesture
  const animatingRef = useRef(false);
  const closingRef = useRef(false);
  const tapRef = useRef({ t: 0, x: 0, y: 0, timer: null });
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const indexRef = useRef(index);
  indexRef.current = index;
  const { openMenu } = useContextMenu();
  const { showToast } = useToast();

  const img = images[index];

  // ---- zoom / pan helpers ---------------------------------------------------
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setOrigin({ x: 50, y: 50 });
  }, [index]);

  function clampPan(next, z) {
    if (z <= 1) return { x: 0, y: 0 };
    const el = imgRef.current;
    const maxX = el ? (el.clientWidth * (z - 1)) / 2 : 400 * z;
    const maxY = el ? (el.clientHeight * (z - 1)) / 2 : 400 * z;
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }

  function originFromPoint(clientX, clientY) {
    const el = imgRef.current;
    if (!el) return { x: 50, y: 50 };
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)),
    };
  }

  // ---- closing (animated) -------------------------------------------------
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(() => onClose?.(), CLOSE_MS);
  }, [onClose]);

  // ---- moving between photos ----------------------------------------------
  const stageWidth = () => stageRef.current?.clientWidth || window.innerWidth;

  const setTrack = (x, y = 0, scale = 1, transition = "none") => {
    const t = trackRef.current;
    if (!t) return;
    t.style.transition = transition;
    t.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  };
  const setBackdrop = (opacity, transition = "none") => {
    const b = backdropRef.current;
    if (!b) return;
    b.style.transition = transition;
    b.style.opacity = String(opacity);
  };

  // After the index changes the strip is re-laid-out around the new photo, so
  // the track goes back to 0 *before paint* — no flicker, no second animation.
  useLayoutEffect(() => {
    setTrack(0, 0, 1, "none");
    setBackdrop(1, "none");
    animatingRef.current = false;
  }, [index]);

  const goTo = useCallback(
    (dir, { fromDx = 0 } = {}) => {
      const next = indexRef.current + dir;
      if (next < 0 || next >= images.length || animatingRef.current || closingRef.current) return;
      animatingRef.current = true;
      const w = stageWidth() + GAP;
      // Re-start from where the finger left it so the motion is continuous.
      setTrack(fromDx, 0, 1, "none");
      void trackRef.current?.offsetWidth; // flush
      setTrack(-dir * w, 0, 1, `transform ${SLIDE_MS}ms ${EASE}`);
      setTimeout(() => setIndex(next), SLIDE_MS);
    },
    [images.length]
  );

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") requestClose();
      if (e.key === "ArrowRight") goTo(1);
      if (e.key === "ArrowLeft") goTo(-1);
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(MAX_ZOOM, z + 0.4));
      if (e.key === "-") setZoom((z) => Math.max(MIN_ZOOM, z - 0.4));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, requestClose]);

  // Wheel-to-zoom, as a non-passive native listener (React's onWheel is passive).
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return undefined;
    function handleWheel(e) {
      e.preventDefault();
      setOrigin(originFromPoint(e.clientX, e.clientY));
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - e.deltaY * 0.0018 * z));
        if (next <= 1.02) {
          setPan({ x: 0, y: 0 });
          setOrigin({ x: 50, y: 50 });
        }
        return next;
      });
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Lock the page behind the viewer.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Touch listeners are attached natively (non-passive) so a horizontal or
  // vertical drag can stop the browser from also scrolling/refreshing the page.
  const handlersRef = useRef({});
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const start = (e) => handlersRef.current.start(e);
    const move = (e) => handlersRef.current.move(e);
    const end = (e) => handlersRef.current.end(e);
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end, { passive: true });
    el.addEventListener("touchcancel", end, { passive: true });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, []);

  // ---- mouse pan (zoomed) --------------------------------------------------
  function handleMouseDown(e) {
    if (zoom <= 1) return;
    setDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: pan };
  }
  function handleMouseMove(e) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan(clampPan({ x: dragRef.current.origin.x + dx, y: dragRef.current.origin.y + dy }, zoom));
  }
  function endDrag() {
    dragRef.current = null;
    setDragging(false);
  }

  // ---- touch: swipe between photos, swipe away to close, pinch, pan ---------
  function touchDistance(touches) {
    const [a, b] = touches;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  function handleTouchStart(e) {
    if (animatingRef.current || closingRef.current) return;
    if (e.touches.length === 1 && e.target.closest?.("video[controls]")) {
      // Let a video's own controls (seek bar etc.) keep their gestures.
      const rect = e.target.getBoundingClientRect();
      if (e.touches[0].clientY > rect.bottom - 56) return;
    }
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      pinchRef.current = { startDist: touchDistance(e.touches), startZoom: zoomRef.current };
      setOrigin(originFromPoint((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2));
      dragRef.current = null;
      gestureRef.current = null;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      if (zoomRef.current > 1) {
        dragRef.current = { startX: t.clientX, startY: t.clientY, origin: panRef.current };
        gestureRef.current = null;
      } else {
        const now = Date.now();
        gestureRef.current = { startX: t.clientX, startY: t.clientY, lastX: t.clientX, lastY: t.clientY, t: now, lastT: now, vx: 0, vy: 0, axis: null };
      }
    }
  }

  function handleTouchMove(e) {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const dist = touchDistance(e.touches);
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchRef.current.startZoom * (dist / pinchRef.current.startDist)));
      setZoom(next);
      if (next <= 1.02) {
        setPan({ x: 0, y: 0 });
        setOrigin({ x: 50, y: 50 });
      }
      return;
    }
    const g = gestureRef.current;
    if (e.touches.length === 1 && g && zoomRef.current <= 1) {
      const t = e.touches[0];
      const dx = t.clientX - g.startX;
      const dy = t.clientY - g.startY;
      if (!g.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 9) {
        g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      const now = Date.now();
      const dt = Math.max(1, now - g.lastT);
      g.vx = (t.clientX - g.lastX) / dt;
      g.vy = (t.clientY - g.lastY) / dt;
      g.lastX = t.clientX;
      g.lastY = t.clientY;
      g.lastT = now;

      if (g.axis === "x") {
        if (e.cancelable) e.preventDefault();
        const i = indexRef.current;
        const atEdge = (dx > 0 && i === 0) || (dx < 0 && i === images.length - 1);
        setTrack(atEdge ? dx * 0.28 : dx, 0, 1, "none"); // rubber-band at the ends
      } else if (g.axis === "y") {
        if (e.cancelable) e.preventDefault();
        const h = window.innerHeight;
        const progress = Math.min(1, Math.abs(dy) / (h * 0.55));
        setTrack(dx * 0.35, dy, 1 - progress * 0.22, "none");
        setBackdrop(1 - progress * 0.9, "none");
      }
    } else if (e.touches.length === 1 && dragRef.current) {
      if (e.cancelable) e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - dragRef.current.startX;
      const dy = t.clientY - dragRef.current.startY;
      setPan(clampPan({ x: dragRef.current.origin.x + dx, y: dragRef.current.origin.y + dy }, zoomRef.current));
    }
  }

  function handleTouchEnd(e) {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length > 0) return;

    const g = gestureRef.current;
    gestureRef.current = null;
    dragRef.current = null;
    setDragging(false);
    if (!g || zoomRef.current > 1) return;

    const touch = e.changedTouches[0];
    const dx = touch.clientX - g.startX;
    const dy = touch.clientY - g.startY;
    const w = stageWidth();

    if (g.axis === "x") {
      const dir = dx < 0 ? 1 : -1;
      const target = indexRef.current + dir;
      const hasNext = target >= 0 && target < images.length;
      const far = Math.abs(dx) > w * 0.22;
      const fast = Math.abs(g.vx) > 0.45 && Math.abs(dx) > 28;
      if (hasNext && (far || fast)) {
        try { navigator.vibrate?.(5); } catch { /* ignore */ }
        goTo(dir, { fromDx: dx });
      } else {
        setTrack(0, 0, 1, `transform ${SLIDE_MS - 60}ms ${EASE}`);
      }
      return;
    }

    if (g.axis === "y") {
      const h = window.innerHeight;
      if (Math.abs(dy) > Math.max(110, h * 0.16) || Math.abs(g.vy) > 0.6) {
        // Fly off in the direction it was thrown while the backdrop fades out.
        closingRef.current = true;
        setFlying(true);
        setClosing(true);
        setTrack(dx * 0.35, Math.sign(dy || 1) * h * 0.55, 0.7, `transform ${CLOSE_MS}ms ease-in`);
        setBackdrop(0, `opacity ${CLOSE_MS}ms ease-in`);
        setTimeout(() => onClose?.(), CLOSE_MS);
      } else {
        setTrack(0, 0, 1, `transform ${SLIDE_MS - 60}ms ${EASE}`);
        setBackdrop(1, `opacity ${SLIDE_MS - 60}ms ease`);
      }
      return;
    }

    // A tap (no real movement): double-tap zooms, single tap hides/shows the controls.
    if (Math.hypot(dx, dy) < 10 && Date.now() - g.t < 350) {
      const now = Date.now();
      const prev = tapRef.current;
      if (now - prev.t < 300 && Math.hypot(touch.clientX - prev.x, touch.clientY - prev.y) < 40) {
        clearTimeout(prev.timer);
        tapRef.current = { t: 0, x: 0, y: 0, timer: null };
        if (e.target.closest?.(".lb-media") && !e.target.closest?.("video")) toggleZoom(touch);
      } else {
        clearTimeout(prev.timer);
        tapRef.current = {
          t: now,
          x: touch.clientX,
          y: touch.clientY,
          timer: setTimeout(() => setChromeHidden((h) => !h), 300),
        };
      }
    }
  }

  const panRef = useRef(pan);
  panRef.current = pan;
  handlersRef.current = { start: handleTouchStart, move: handleTouchMove, end: handleTouchEnd };
  useEffect(() => () => clearTimeout(tapRef.current.timer), []);

  function toggleZoom(e) {
    if (zoomRef.current > 1) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setOrigin({ x: 50, y: 50 });
    } else {
      setOrigin(originFromPoint(e.clientX, e.clientY));
      setZoom(2.4);
    }
  }

  function handleBackgroundMouseDown(e) {
    if (dragRef.current || pinchRef.current) return;
    if (e.target.closest(".lb-media, .lightbox-topbar, .lightbox-nav, .lb-dialog, .lb-status")) return;
    requestClose();
  }

  function handleLightboxContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  const resolvedUrl = active.url;

  function handleStageContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!resolvedUrl) return;
    const owner = img?._message || message;
    const myReaction = owner?.reactions?.find(
      (reaction) => (reaction.user?._id || reaction.user) === userId
    )?.emoji;
    openMenu(
      e,
      [
        onForward && { label: "Forward", icon: <ForwardIcon size={15} />, onClick: () => onForward(img) },
        { label: "Open in new tab", icon: <ExternalLinkIcon size={15} />, onClick: () => window.open(resolvedUrl, "_blank", "noopener,noreferrer") },
        img?.kind !== "video" && { label: "Copy image", icon: <CopyIcon size={15} />, onClick: () => copyImageToClipboard(resolvedUrl, showToast) },
        {
          label: "Save as…",
          icon: <DownloadIcon size={15} />,
          onClick: () => {
            const link = document.createElement("a");
            link.href = resolvedUrl;
            link.download = img.name || "image.png";
            link.click();
          },
        },
      ].filter(Boolean),
      null,
      reactToMessage && owner?._id
        ? {
            reactions: {
              emojis: QUICK_EMOJI,
              current: myReaction,
              onPick: (emoji) => reactToMessage(owner._id, emoji),
            },
          }
        : undefined
    );
  }

  if (!img) return null;

  // Only the photo you're on and its two neighbours are mounted.
  const visible = [index - 1, index, index + 1].filter((i) => i >= 0 && i < images.length);

  return createPortal(
    <div
      className={`lightbox lb-root ${closing ? "closing" : ""} ${flying ? "lb-flying" : ""} ${chromeHidden ? "chrome-hidden" : ""}`}
      ref={overlayRef}
      onMouseDown={handleBackgroundMouseDown}
      onContextMenu={handleLightboxContextMenu}
    >
      <div className="lb-backdrop" ref={backdropRef} />

      <div className="lightbox-topbar">
        <button className="lightbox-icon-btn" onClick={requestClose} title="Close (Esc)" aria-label="Close">
          <CloseIcon size={20} />
        </button>
        <span className="lightbox-counter">{images.length > 1 ? `${index + 1} / ${images.length}` : ""}</span>
        <div className="lightbox-topbar-actions">
          {onForward && (
            <button className="lightbox-icon-btn" onClick={() => onForward(img)} title="Forward" aria-label="Forward">
              <ForwardIcon size={18} />
            </button>
          )}
          <a
            className={`lightbox-icon-btn ${resolvedUrl ? "" : "disabled"}`}
            href={resolvedUrl || undefined}
            download={img.name || "image.png"}
            onClick={(e) => {
              if (!isNative || !resolvedUrl) return;
              e.preventDefault(); // Android WebView ignores <a download> — save into the WispChat folder instead
              nativeDownload({ url: resolvedUrl, name: img.name, mimeType: img.mimeType, kind: img.kind === "video" ? "video" : "image" }, showToast);
            }}
            title="Download"
            aria-label="Download"
          >
            <DownloadIcon size={18} />
          </a>
        </div>
      </div>

      {index > 0 && (
        <button className="lightbox-nav left" onClick={() => goTo(-1)} title="Previous" aria-label="Previous">
          ‹
        </button>
      )}

      <div
        className="lightbox-stage"
        ref={stageRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onContextMenu={handleStageContextMenu}
      >
        <div className="lb-track" ref={trackRef}>
          {visible.map((i) => (
            <LightboxSlide
              key={i}
              img={images[i]}
              fallbackMessage={message}
              pos={i - index}
              active={i === index}
              zoom={zoom}
              pan={pan}
              origin={origin}
              dragging={dragging}
              imgRef={imgRef}
              onDoubleClick={toggleZoom}
              onActiveState={setActive}
            />
          ))}
        </div>
      </div>

      {index < images.length - 1 && (
        <button className="lightbox-nav right" onClick={() => goTo(1)} title="Next" aria-label="Next">
          ›
        </button>
      )}

      {zoom > 1 && <div className="lightbox-zoom-hint">{Math.round(zoom * 100)}%</div>}

      {/* The file is gone (deleted from the server / never uploaded): say so, then leave. */}
      {active.missing && !closing && (
        <div className="lb-dialog-wrap" role="alertdialog" aria-modal="true" aria-label="Media unavailable">
          <div className="lb-dialog">
            <p>Sorry, this media file isn't available. It may have been removed from the server.</p>
            <button type="button" autoFocus onClick={requestClose}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
