import { useCallback, useEffect, useRef, useState } from "react";
import { RotateIcon, ZoomInIcon, ZoomOutIcon, UndoIcon } from "../common/Icons";

// Crops a photo to the vertical 9:16 "story" frame. Drag to pan, pinch / wheel
// / slider to zoom, rotate in 90° steps, and choose Fill (crop to cover the
// frame) or Fit (whole photo with a blurred backdrop). The preview and the
// exported 1080×1920 image use the same maths, so what you see is what posts.
const OUT_W = 1080;
const OUT_H = 1920;
const MAX_ZOOM = 4;

export default function StatusCropper({ src, onChange }) {
  const frameRef = useRef(null);
  const imgRef = useRef(null);
  const [nat, setNat] = useState(null); // { w, h } natural size
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0); // 0 | 90 | 180 | 270
  const [mode, setMode] = useState("fill"); // fill | fit
  const [off, setOff] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map());
  const gesture = useRef(null);

  // Track the frame's real pixel size (it's responsive).
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const measure = () => setFrame({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const swapped = rot === 90 || rot === 270;
  const ew = nat ? (swapped ? nat.h : nat.w) : 0; // effective (post-rotation) size
  const eh = nat ? (swapped ? nat.w : nat.h) : 0;
  const base = nat && frame.w ? (mode === "fill" ? Math.max(frame.w / ew, frame.h / eh) : Math.min(frame.w / ew, frame.h / eh)) : 1;
  const scale = base * zoom;

  const clamp = useCallback(
    (o, s = scale) => {
      if (!nat) return { x: 0, y: 0 };
      const maxX = Math.max(0, (ew * s - frame.w) / 2);
      const maxY = Math.max(0, (eh * s - frame.h) / 2);
      return { x: Math.max(-maxX, Math.min(maxX, o.x)), y: Math.max(-maxY, Math.min(maxY, o.y)) };
    },
    [nat, ew, eh, frame.w, frame.h, scale]
  );

  // Re-clamp whenever the geometry changes.
  useEffect(() => {
    setOff((o) => clamp(o));
  }, [clamp]);

  function reset() {
    setZoom(1);
    setRot(0);
    setMode("fill");
    setOff({ x: 0, y: 0 });
  }

  // ----- gestures -----
  function onPointerDown(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current = { startOff: off, startZoom: zoom, startDist: null, start: { x: e.clientX, y: e.clientY } };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.startDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }
  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size >= 2 && g.startDist) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const z = Math.max(1, Math.min(MAX_ZOOM, g.startZoom * (dist / g.startDist)));
      setZoom(z);
      return;
    }
    setOff(clamp({ x: g.startOff.x + (e.clientX - g.start.x), y: g.startOff.y + (e.clientY - g.start.y) }));
  }
  function onPointerUp(e) {
    pointers.current.delete(e.pointerId);
    gesture.current = pointers.current.size ? { startOff: off, startZoom: zoom, startDist: null, start: [...pointers.current.values()][0] } : null;
  }
  function onWheel(e) {
    e.preventDefault();
    setZoom((z) => Math.max(1, Math.min(MAX_ZOOM, z * (e.deltaY < 0 ? 1.08 : 0.92))));
  }
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const handler = (e) => onWheel(e);
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // ----- export -----
  const exportBlob = useCallback(async () => {
    const img = imgRef.current;
    if (!img || !nat || !frame.w) return null;
    const k = OUT_W / frame.w;
    const canvas = document.createElement("canvas");
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    const draw = (s, o, r) => {
      ctx.save();
      ctx.translate(OUT_W / 2 + o.x * k, OUT_H / 2 + o.y * k);
      ctx.rotate((r * Math.PI) / 180);
      ctx.scale(s * k, s * k);
      ctx.drawImage(img, -nat.w / 2, -nat.h / 2);
      ctx.restore();
    };
    if (mode === "fit") {
      // Blurred, zoomed copy as a backdrop so there are no hard black bars.
      const coverScale = Math.max(frame.w / ew, frame.h / eh) * 1.15;
      try {
        ctx.filter = "blur(36px) brightness(0.7)";
      } catch {
        /* older Safari: skip blur */
      }
      draw(coverScale, { x: 0, y: 0 }, rot);
      ctx.filter = "none";
    }
    draw(scale, off, rot);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  }, [nat, frame.w, frame.h, ew, eh, mode, rot, scale, off]);

  // Parent pulls the result when "Next" is pressed.
  useEffect(() => {
    onChange?.({ ready: !!nat, getBlob: exportBlob });
  }, [nat, exportBlob, onChange]);

  return (
    <div className="status-cropper">
      <div
        ref={frameRef}
        className={`status-cropper-frame ${mode}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: "none" }}
      >
        {mode === "fit" && <div className="status-cropper-bg" style={{ backgroundImage: `url(${src})` }} />}
        <img
          ref={imgRef}
          src={src}
          alt=""
          draggable={false}
          data-no-fallback
          onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: nat ? nat.w : "auto",
            height: nat ? nat.h : "auto",
            maxWidth: "none",
            transform: `translate(-50%, -50%) translate(${off.x}px, ${off.y}px) rotate(${rot}deg) scale(${scale})`,
            transformOrigin: "center",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
        <div className="status-cropper-grid" aria-hidden="true" />
        <span className="status-cropper-badge">9:16</span>
      </div>

      <div className="status-cropper-controls">
        <div className="status-cropper-modes" role="tablist" aria-label="Framing">
          <button type="button" role="tab" aria-selected={mode === "fill"} className={mode === "fill" ? "active" : ""} onClick={() => { setMode("fill"); setZoom(1); setOff({ x: 0, y: 0 }); }}>
            Fill
          </button>
          <button type="button" role="tab" aria-selected={mode === "fit"} className={mode === "fit" ? "active" : ""} onClick={() => { setMode("fit"); setZoom(1); setOff({ x: 0, y: 0 }); }}>
            Fit
          </button>
        </div>
        <div className="status-cropper-zoom">
          <button type="button" className="icon-btn btn-sm" title="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.15))}>
            <ZoomOutIcon size={16} />
          </button>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
          />
          <button type="button" className="icon-btn btn-sm" title="Zoom in" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.15))}>
            <ZoomInIcon size={16} />
          </button>
        </div>
        <button type="button" className="icon-btn btn-sm" title="Rotate 90°" onClick={() => { setRot((r) => (r + 90) % 360); setOff({ x: 0, y: 0 }); }}>
          <RotateIcon size={17} />
        </button>
        <button type="button" className="icon-btn btn-sm" title="Reset" onClick={reset}>
          <UndoIcon size={17} />
        </button>
      </div>
    </div>
  );
}
