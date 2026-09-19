import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  DrawIcon,
  CropIcon,
  RotateIcon,
  UndoIcon,
  CheckIcon,
  CloseIcon,
  AlertIcon,
} from "../common/Icons";

const COLORS = ["#ff5c5c", "#ffd166", "#5ef2c0", "#38bdf8", "#a78bfa", "#ffffff", "#111318"];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function canvasFromImage(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || 800;
  c.height = img.naturalHeight || 600;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return c;
}

const ImageEditor = forwardRef(function ImageEditor({ originalUrl }, ref) {
  const displayCanvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [workingCanvas, setWorkingCanvas] = useState(null);
  const [history, setHistory] = useState([]);
  const [strokes, setStrokes] = useState([]);
  const [mode, setMode] = useState("none"); // none | draw | crop
  const [color, setColor] = useState(COLORS[2]);
  const [brushSize, setBrushSize] = useState(6);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef(null);
  const cropStartRef = useRef(null);
  const [cropRect, setCropRect] = useState(null);
  const [displaySize, setDisplaySize] = useState({ w: 1, h: 1 });
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    loadImage(originalUrl)
      .then(async (img) => {
        if (cancelled) return;
        const canvas = await canvasFromImage(img);
        setWorkingCanvas(canvas);
        setHistory([canvas]);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [originalUrl]);

  // Fit + redraw whenever working canvas, strokes, or crop changes
  useEffect(() => {
    if (!workingCanvas || !displayCanvasRef.current) return;
    const maxW = wrapRef.current?.clientWidth || 560;
    const maxH = wrapRef.current?.clientHeight || 440;
    const ratio = Math.min(maxW / workingCanvas.width, maxH / workingCanvas.height, 1);
    const w = Math.max(10, Math.round(workingCanvas.width * ratio));
    const h = Math.max(10, Math.round(workingCanvas.height * ratio));
    setDisplaySize({ w, h });

    const dc = displayCanvasRef.current;
    dc.width = w;
    dc.height = h;
    const ctx = dc.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(workingCanvas, 0, 0, w, h);

    // Draw pending strokes safely
    if (Array.isArray(strokes)) {
      strokes.forEach((s) => {
        if (s && Array.isArray(s.points)) {
          drawStroke(ctx, s, w, h);
        }
      });
    }

    if (cropRect) {
      ctx.save();
      ctx.fillStyle = "rgba(5, 7, 9, 0.65)";
      ctx.fillRect(0, 0, w, h);
      const rx = cropRect.x * w;
      const ry = cropRect.y * h;
      const rw = cropRect.w * w;
      const rh = cropRect.h * h;
      ctx.clearRect(rx, ry, rw, rh);
      ctx.drawImage(
        workingCanvas,
        cropRect.x * workingCanvas.width,
        cropRect.y * workingCanvas.height,
        cropRect.w * workingCanvas.width,
        cropRect.h * workingCanvas.height,
        rx,
        ry,
        rw,
        rh
      );
      ctx.strokeStyle = "#5ef2c0";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }
  }, [workingCanvas, strokes, cropRect]);

  function drawStroke(ctx, stroke, w, h) {
    if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) return;
    ctx.strokeStyle = stroke.color || "#5ef2c0";
    ctx.lineWidth = Math.max(1, (stroke.size || 0.01) * w);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    stroke.points.forEach((p, i) => {
      if (!p) return;
      const x = p.x * w;
      const y = p.y * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function relativePoint(e) {
    if (!displayCanvasRef.current) return { x: 0, y: 0 };
    const rect = displayCanvasRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  }

  function handlePointerDown(e) {
    if (mode === "draw") {
      drawingRef.current = true;
      const pt = relativePoint(e);
      const newStroke = {
        color,
        size: brushSize / Math.max(displaySize.w, 100),
        points: [pt],
      };
      currentStrokeRef.current = newStroke;
      setStrokes((s) => [...(s || []).filter(Boolean), newStroke]);
    } else if (mode === "crop") {
      cropStartRef.current = relativePoint(e);
      setCropRect({ x: cropStartRef.current.x, y: cropStartRef.current.y, w: 0, h: 0 });
    }
  }

  function handlePointerMove(e) {
    if (mode === "draw" && drawingRef.current && currentStrokeRef.current) {
      const pt = relativePoint(e);
      currentStrokeRef.current.points.push(pt);
      setStrokes((s) => [
        ...(s || []).filter((x) => x && x !== currentStrokeRef.current),
        { ...currentStrokeRef.current },
      ]);
    } else if (mode === "crop" && cropStartRef.current) {
      const pt = relativePoint(e);
      const start = cropStartRef.current;
      setCropRect({
        x: Math.max(0, Math.min(start.x, pt.x)),
        y: Math.max(0, Math.min(start.y, pt.y)),
        w: Math.abs(pt.x - start.x),
        h: Math.abs(pt.y - start.y),
      });
    }
  }

  function handlePointerUp() {
    if (mode === "draw" && drawingRef.current) {
      drawingRef.current = false;
      currentStrokeRef.current = null;
    }
    if (mode === "crop") {
      cropStartRef.current = null;
    }
  }

  function flattenStrokesIntoWorking() {
    if (!workingCanvas) return document.createElement("canvas");
    if (!strokes || strokes.length === 0) return workingCanvas;
    const c = document.createElement("canvas");
    c.width = workingCanvas.width;
    c.height = workingCanvas.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(workingCanvas, 0, 0);
    strokes.filter(Boolean).forEach((s) => drawStroke(ctx, s, c.width, c.height));
    return c;
  }

  function commitHistory(canvas) {
    setWorkingCanvas(canvas);
    setHistory((h) => [...h, canvas]);
    setStrokes([]);
  }

  function handleRotate() {
    const flattened = flattenStrokesIntoWorking();
    const c = document.createElement("canvas");
    c.width = flattened.height;
    c.height = flattened.width;
    const ctx = c.getContext("2d");
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(flattened, -flattened.width / 2, -flattened.height / 2);
    commitHistory(c);
  }

  function applyCrop() {
    if (!cropRect || cropRect.w < 0.03 || cropRect.h < 0.03) {
      setCropRect(null);
      setMode("none");
      return;
    }
    const flattened = flattenStrokesIntoWorking();
    const sx = cropRect.x * flattened.width;
    const sy = cropRect.y * flattened.height;
    const sw = cropRect.w * flattened.width;
    const sh = cropRect.h * flattened.height;
    const c = document.createElement("canvas");
    c.width = Math.max(10, sw);
    c.height = Math.max(10, sh);
    const ctx = c.getContext("2d");
    ctx.drawImage(flattened, sx, sy, sw, sh, 0, 0, c.width, c.height);
    commitHistory(c);
    setCropRect(null);
    setMode("none");
  }

  function handleUndo() {
    if (history.length <= 1) {
      setStrokes([]);
      return;
    }
    const next = history.slice(0, -1);
    setHistory(next);
    setWorkingCanvas(next[next.length - 1]);
    setStrokes([]);
    setCropRect(null);
  }

  function clearDrawing() {
    setStrokes([]);
  }

  useImperativeHandle(ref, () => ({
    async getFinalBlob() {
      const finalCanvas = flattenStrokesIntoWorking();
      return new Promise((resolve) => {
        finalCanvas.toBlob((blob) => resolve(blob), "image/png", 0.95);
      });
    },
    isEdited() {
      return history.length > 1 || strokes.length > 0;
    },
  }));

  if (loadError) {
    return (
      <div className="image-editor">
        <div className="media-composer-generic-preview">
          <AlertIcon size={48} />
          <div>Couldn't load this image</div>
        </div>
      </div>
    );
  }

  return (
    <div className="image-editor">
      <div className="image-editor-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={displayCanvasRef}
          className={`image-editor-canvas mode-${mode}`}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
        />
      </div>

      <div className="image-editor-toolbar">
        <button
          className={mode === "draw" ? "active" : ""}
          onClick={() => setMode(mode === "draw" ? "none" : "draw")}
          title="Freehand Draw"
        >
          <DrawIcon size={16} /> Draw
        </button>
        <button
          className={mode === "crop" ? "active" : ""}
          onClick={() => setMode(mode === "crop" ? "none" : "crop")}
          title="Crop image"
        >
          <CropIcon size={16} /> Crop
        </button>
        <button onClick={handleRotate} title="Rotate 90° clockwise">
          <RotateIcon size={16} /> Rotate
        </button>
        <button
          onClick={handleUndo}
          title="Undo last action"
          disabled={history.length <= 1 && strokes.length === 0}
        >
          <UndoIcon size={16} /> Undo
        </button>

        {mode === "draw" && (
          <div className="image-editor-draw-controls">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${color === c ? "active" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
            <input
              type="range"
              min="2"
              max="24"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              title={`Brush Size: ${brushSize}px`}
            />
            {strokes.length > 0 && (
              <button className="link-btn-inline" onClick={clearDrawing}>
                Clear
              </button>
            )}
          </div>
        )}

        {mode === "crop" && cropRect && (
          <div className="image-editor-draw-controls">
            <button className="btn btn-primary btn-sm" onClick={applyCrop}>
              <CheckIcon size={13} /> Apply crop
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setCropRect(null);
                setMode("none");
              }}
            >
              <CloseIcon size={13} /> Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

export default ImageEditor;
