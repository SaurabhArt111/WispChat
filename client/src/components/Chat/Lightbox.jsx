import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, DownloadIcon, ForwardIcon, ExternalLinkIcon, CopyIcon } from "../common/Icons";
import { copyImageToClipboard } from "../../utils/copyImage";
import { useDecryptedMediaUrl } from "../../hooks/useDecryptedMessage";
import { useContextMenu } from "../../context/ContextMenuContext";
import { useToast } from "../../context/ToastContext";

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

export default function Lightbox({ message, images, startIndex = 0, onClose, onForward }) {
  const [index, setIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const pinchRef = useRef(null);
  const overlayRef = useRef(null);
  const { openMenu } = useContextMenu();
  const { showToast } = useToast();

  // Reset zoom/pan whenever the active image changes.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [index]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, images.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(MAX_ZOOM, z + 0.4));
      if (e.key === "-") setZoom((z) => Math.max(MIN_ZOOM, z - 0.4));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  // Wheel-to-zoom, attached as a *non-passive* native listener. React's
  // JSX onWheel always registers as a passive listener, which silently
  // swallows preventDefault() (the browser logs a warning and the page
  // scrolls right through the lightbox — the bug this fixes). Wiring it
  // manually with { passive: false } is the only way to actually stop
  // the page scrolling while zooming with the trackpad/wheel. Attached to
  // the whole overlay (not just the stage) so a wheel/trackpad gesture
  // that starts over the topbar or nav buttons doesn't leak through to
  // the page underneath either.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    function handleWheel(e) {
      e.preventDefault();
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - e.deltaY * 0.0018 * z));
        if (next <= 1.02) setPan({ x: 0, y: 0 });
        return next;
      });
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // The whole overlay is a fixed, full-screen layer with nothing behind
  // it that should ever scroll — but while it's open we also lock the
  // body itself, belt-and-braces, so no stray scroll (e.g. from a
  // trackpad gesture the wheel handler above doesn't catch) can leak
  // through to the page underneath.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  function handleMouseDown(e) {
    if (zoom <= 1) return;
    setDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: pan };
  }
  function handleMouseMove(e) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan({ x: dragRef.current.origin.x + dx, y: dragRef.current.origin.y + dy });
  }
  function endDrag() {
    dragRef.current = null;
    setDragging(false);
  }

  // Touch: one finger pans (when zoomed in), two fingers pinch-zoom —
  // mirrors the mouse drag/wheel-zoom behavior above for mobile/trackpad
  // touchscreens.
  function touchDistance(touches) {
    const [a, b] = touches;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
  function handleTouchStart(e) {
    if (e.touches.length === 2) {
      pinchRef.current = { startDist: touchDistance(e.touches), startZoom: zoom };
      dragRef.current = null;
    } else if (e.touches.length === 1 && zoom > 1) {
      const t = e.touches[0];
      dragRef.current = { startX: t.clientX, startY: t.clientY, origin: pan };
    }
  }
  function handleTouchMove(e) {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const dist = touchDistance(e.touches);
      const ratio = dist / pinchRef.current.startDist;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchRef.current.startZoom * ratio));
      setZoom(next);
      if (next <= 1.02) setPan({ x: 0, y: 0 });
    } else if (e.touches.length === 1 && dragRef.current) {
      e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - dragRef.current.startX;
      const dy = t.clientY - dragRef.current.startY;
      setPan({ x: dragRef.current.origin.x + dx, y: dragRef.current.origin.y + dy });
    }
  }
  function handleTouchEnd(e) {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0) dragRef.current = null;
  }

  function toggleZoom(e) {
    // Double-click: quick zoom to 2.4x at click point, or back out to 1x.
    if (zoom > 1) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      setZoom(2.4);
    }
  }

  // Closing on a background click needs to check the actual click target
  // against an allowlist of "interactive" elements (the image itself, nav
  // arrows, topbar buttons) rather than a strict e.target === e.currentTarget
  // check — the stage is its own nested element with padding around the
  // image, and a plain equality check only caught clicks on the outermost
  // wrapper, not that padding area, which is why clicking "off the image"
  // inside the stage didn't close it before.
  function handleBackgroundMouseDown(e) {
    if (dragRef.current || pinchRef.current) return; // don't close mid-drag/pinch
    if (e.target.closest(".lightbox-img, .lightbox-topbar, .lightbox-nav")) return;
    onClose();
  }

  async function handleCopyImage(url) {
    await copyImageToClipboard(url, showToast);
  }

  function handleStageContextMenu(e) {
    e.preventDefault();
    if (!resolvedUrl) return;
    openMenu(
      e,
      [
        onForward && { label: "Forward", icon: <ForwardIcon size={15} />, onClick: () => onForward(img) },
        { label: "Open in new tab", icon: <ExternalLinkIcon size={15} />, onClick: () => window.open(resolvedUrl, "_blank", "noopener,noreferrer") },
        { label: "Copy image", icon: <CopyIcon size={15} />, onClick: () => handleCopyImage(resolvedUrl) },
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
      ].filter(Boolean)
    );
  }

  const img = images[index];
  const { url: resolvedUrl, loading, error } = useDecryptedMediaUrl(img?._message || message, img);
  if (!img) return null;

  return createPortal(
    <div className="lightbox" ref={overlayRef} onMouseDown={handleBackgroundMouseDown}>
      <div className="lightbox-topbar">
        <button className="lightbox-icon-btn" onClick={onClose} title="Close (Esc)">
          <CloseIcon size={20} />
        </button>
        <span className="lightbox-counter">
          {images.length > 1 ? `${index + 1} / ${images.length}` : ""}
        </span>
        <div className="lightbox-topbar-actions">
          {onForward && (
            <button
              className="lightbox-icon-btn"
              onClick={() => onForward(img)}
              title="Forward"
            >
              <ForwardIcon size={18} />
            </button>
          )}
          <a className="lightbox-icon-btn" href={resolvedUrl || undefined} download={img.name || "image.png"} title="Download">
            <DownloadIcon size={18} />
          </a>
        </div>
      </div>

      {index > 0 && (
        <button
          className="lightbox-nav left"
          onClick={() => setIndex((i) => i - 1)}
          title="Previous image"
        >
          ‹
        </button>
      )}

      <div
        className="lightbox-stage"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onContextMenu={handleStageContextMenu}
      >
        <img
          src={resolvedUrl || ""}
          alt={img.name || "Photo"}
          className="lightbox-img"
          draggable={false}
          onDoubleClick={toggleZoom}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in",
            opacity: loading || !resolvedUrl ? 0.3 : 1,
            touchAction: zoom > 1 ? "none" : "auto",
          }}
        />
        {loading && <div className="lightbox-zoom-hint">Decrypting…</div>}
        {error && <div className="lightbox-zoom-hint">Couldn't decrypt this image</div>}
      </div>

      {index < images.length - 1 && (
        <button
          className="lightbox-nav right"
          onClick={() => setIndex((i) => i + 1)}
          title="Next image"
        >
          ›
        </button>
      )}

      {zoom > 1 && <div className="lightbox-zoom-hint">{Math.round(zoom * 100)}%</div>}
    </div>,
    document.body
  );
}
