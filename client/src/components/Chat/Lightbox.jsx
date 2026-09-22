import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, DownloadIcon, ForwardIcon } from "../common/Icons";
import { mediaUrl } from "../../api/config";

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

export default function Lightbox({ images, startIndex = 0, onClose, onForward }) {
  const [index, setIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const stageRef = useRef(null);

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

  // Scroll (wheel/trackpad) to zoom in and out, centered roughly on the
  // cursor. At 1x zoom, pan resets so the image doesn't stay off-center
  // when the user zooms back out.
  function handleWheel(e) {
    e.preventDefault();
    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - e.deltaY * 0.0018 * z));
      if (next <= 1.02) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  function handleMouseDown(e) {
    if (zoom <= 1) return;
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

  const img = images[index];
  if (!img) return null;

  return createPortal(
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
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
          <a className="lightbox-icon-btn" href={mediaUrl(img.url)} download={img.name || "image.png"} title="Download">
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
        ref={stageRef}
        className="lightbox-stage"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <img
          src={mediaUrl(img.url)}
          alt={img.name || "Photo"}
          className="lightbox-img"
          draggable={false}
          onDoubleClick={toggleZoom}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            cursor: zoom > 1 ? "grab" : "zoom-in",
          }}
        />
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
