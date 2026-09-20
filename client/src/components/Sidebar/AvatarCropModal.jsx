import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, ZoomInIcon, ZoomOutIcon } from "../common/Icons";

const VIEWPORT = 280; // css px, square
const OUTPUT = 512; // exported avatar is always 512x512

/**
 * A dedicated, crop-only editor for profile photos: whatever the user
 * uploads, the saved avatar is always a 1:1 square, and nothing is applied
 * until they explicitly hit "Save Profile Photo". Distinct from the general
 * MediaComposer/ImageEditor (which also offers draw/rotate) — profile
 * photos only ever get cropped, never annotated.
 */
export default function AvatarCropModal({ file, onCancel, onSave }) {
  const [imgUrl, setImgUrl] = useState("");
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const imgRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    const nextUrl = URL.createObjectURL(file);
    setImgUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  function onImgLoad(e) {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    setNatural({ w, h });
    // Start zoomed so the shorter side exactly fills the square viewport —
    // guarantees there's never empty space around the crop.
    const baseScale = VIEWPORT / Math.min(w, h);
    setZoom(baseScale);
    setPan({ x: 0, y: 0 });
  }

  const minZoom = natural.w ? VIEWPORT / Math.min(natural.w, natural.h) : 1;

  function clampPan(nextPan, z) {
    if (!natural.w) return nextPan;
    const dispW = natural.w * z;
    const dispH = natural.h * z;
    const maxX = Math.max(0, (dispW - VIEWPORT) / 2);
    const maxY = Math.max(0, (dispH - VIEWPORT) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, nextPan.x)),
      y: Math.min(maxY, Math.max(-maxY, nextPan.y)),
    };
  }

  function handleWheel(e) {
    e.preventDefault();
    const nextZoom = Math.min(minZoom * 4, Math.max(minZoom, zoom - e.deltaY * 0.0015 * zoom));
    setZoom(nextZoom);
    setPan((p) => clampPan(p, nextZoom));
  }

  function handleZoomSlider(e) {
    const nextZoom = Number(e.target.value);
    setZoom(nextZoom);
    setPan((p) => clampPan(p, nextZoom));
  }

  function handlePointerDown(e) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: pan };
  }
  function handlePointerMove(e) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan(clampPan({ x: dragRef.current.origin.x + dx, y: dragRef.current.origin.y + dy }, zoom));
  }
  function endDrag() {
    dragRef.current = null;
  }

  function handleSave() {
    setSaving(true);
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    const outScale = OUTPUT / VIEWPORT;

    // Same transform as the on-screen preview, just rendered at export
    // resolution: center the image, apply pan + zoom, draw into the square.
    const dispW = natural.w * zoom * outScale;
    const dispH = natural.h * zoom * outScale;
    const dx = OUTPUT / 2 - dispW / 2 + pan.x * outScale;
    const dy = OUTPUT / 2 - dispH / 2 + pan.y * outScale;

    ctx.drawImage(imgRef.current, dx, dy, dispW, dispH);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    onSave(dataUrl);
  }

  return createPortal(
    <div className="avatar-crop-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="avatar-crop-card">
        <div className="avatar-crop-header">
          <button className="icon-btn" onClick={onCancel} title="Cancel (Esc)">
            <CloseIcon size={20} />
          </button>
          <div className="avatar-crop-title">Adjust profile photo</div>
          <div style={{ width: 36 }} />
        </div>

        <div
          className="avatar-crop-viewport"
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onWheel={handleWheel}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          <img
            ref={imgRef}
            src={imgUrl || undefined}
            alt=""
            onLoad={onImgLoad}
            draggable={false}
            style={{
              transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          />
          <div className="avatar-crop-ring" />
        </div>

        <div className="avatar-crop-zoom-row">
          <ZoomOutIcon size={16} />
          <input
            type="range"
            min={minZoom}
            max={minZoom * 4}
            step={minZoom / 100}
            value={zoom}
            onChange={handleZoomSlider}
          />
          <ZoomInIcon size={16} />
        </div>

        <p className="avatar-crop-hint">Drag to reposition, scroll or use the slider to zoom.</p>

        <div className="avatar-crop-footer">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : "Save Profile Photo"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
