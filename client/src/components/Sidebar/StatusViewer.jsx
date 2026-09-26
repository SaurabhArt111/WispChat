import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStatus } from "../../context/StatusContext";
import { mediaUrl } from "../../api/config";
import Avatar from "../common/Avatar";
import ConfirmModal from "../common/ConfirmModal";
import { CloseIcon, TrashIcon, EyeIcon } from "../common/Icons";
import { formatClock } from "../../utils/time";
import "../../styles/status.css";

const IMAGE_DURATION = 5000;

export default function StatusViewer({ entry, isOwn, onClose }) {
  const { markViewed, deleteStatus } = useStatus();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showViewers, setShowViewers] = useState(false);
  const [dragY, setDragY] = useState(0);
  const rafRef = useRef(null);
  const startRef = useRef(null);
  const pausedAtRef = useRef(0);
  const videoRef = useRef(null);
  const dismissDragRef = useRef(null);

  const item = entry.items[index];

  // Swiping/scrolling down closes the viewer — mirrors Instagram/WhatsApp
  // status. A downward drag on the content pauses the auto-advance timer
  // (via the existing mouse/touch-down pause handlers) and slides the
  // stage down with the gesture; releasing past a small threshold closes,
  // releasing short of it snaps back. A plain mouse wheel scroll down does
  // the same thing without needing a drag at all.
  function dismissDragStart(clientY) {
    dismissDragRef.current = { startY: clientY, active: true };
  }
  function dismissDragMove(clientY) {
    if (!dismissDragRef.current?.active) return;
    const delta = clientY - dismissDragRef.current.startY;
    setDragY(Math.max(0, delta));
  }
  function dismissDragEnd() {
    if (!dismissDragRef.current?.active) return;
    dismissDragRef.current.active = false;
    if (dragY > 90) {
      onClose();
      return;
    }
    setDragY(0);
  }
  function handleWheel(e) {
    if (e.deltaY > 24) onClose();
  }

  useEffect(() => {
    if (item && !isOwn) markViewed(item._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?._id]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    setProgress(0);
    pausedAtRef.current = 0;
    startRef.current = null;
    setDragY(0);
    if (item?.kind === "video") return; // driven by the <video> timeupdate instead
    const duration = IMAGE_DURATION;

    function tick(ts) {
      if (paused) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (startRef.current === null) startRef.current = ts - pausedAtRef.current;
      const elapsed = ts - startRef.current;
      const pct = Math.min(1, elapsed / duration);
      setProgress(pct);
      if (pct >= 1) {
        goNext();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, item?.kind]);

  useEffect(() => {
    if (paused) {
      cancelAnimationFrame(rafRef.current);
      pausedAtRef.current = progress * IMAGE_DURATION;
      startRef.current = null;
      videoRef.current?.pause();
    } else {
      videoRef.current?.play().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  function goNext() {
    if (index < entry.items.length - 1) {
      setIndex((i) => i + 1);
    } else {
      onClose();
    }
  }
  function goPrev() {
    if (index > 0) setIndex((i) => i - 1);
  }

  function onVideoTimeUpdate(e) {
    const v = e.currentTarget;
    if (v.duration) setProgress(v.currentTime / v.duration);
  }

  async function confirmDelete() {
    await deleteStatus(confirmDeleteId);
    setConfirmDeleteId(null);
    if (entry.items.length <= 1) onClose();
    else goNext();
  }

  return createPortal(
    <div className="status-viewer-overlay" onWheel={handleWheel}>
      <div
        className="status-viewer-stage"
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          opacity: dragY ? Math.max(0.4, 1 - dragY / 260) : 1,
          transition: dismissDragRef.current?.active ? "none" : "transform 160ms var(--ease), opacity 160ms var(--ease)",
        }}
      >
        <div className="status-progress-row">
          {entry.items.map((it, i) => (
            <div className="status-progress-track" key={it._id}>
              <div
                className="status-progress-fill"
                style={{ width: `${i < index ? 100 : i === index ? progress * 100 : 0}%` }}
              />
            </div>
          ))}
        </div>

        <div className="status-viewer-header">
          <Avatar user={entry.user} size={36} />
          <div className="status-viewer-header-text">
            <div className="status-viewer-name">{isOwn ? "My Status" : entry.user.displayName}</div>
            <div className="status-viewer-time">{formatClock(item.createdAt)}</div>
          </div>
          <div className="status-viewer-actions">
            {isOwn && (
              <button className="lightbox-icon-btn" onClick={() => setConfirmDeleteId(item._id)} title="Delete">
                <TrashIcon size={17} />
              </button>
            )}
            <button className="lightbox-icon-btn" onClick={onClose} title="Close (Esc)">
              <CloseIcon size={20} />
            </button>
          </div>
        </div>

        <button className="status-tap-zone left" onClick={goPrev} aria-label="Previous" />
        <button className="status-tap-zone right" onClick={goNext} aria-label="Next" />

        <div
          className="status-viewer-content"
          onMouseDown={(e) => {
            setPaused(true);
            dismissDragStart(e.clientY);
          }}
          onMouseMove={(e) => dismissDragMove(e.clientY)}
          onMouseUp={() => {
            setPaused(false);
            dismissDragEnd();
          }}
          onTouchStart={(e) => {
            setPaused(true);
            dismissDragStart(e.touches[0].clientY);
          }}
          onTouchMove={(e) => dismissDragMove(e.touches[0].clientY)}
          onTouchEnd={() => {
            setPaused(false);
            dismissDragEnd();
          }}
        >
          {item.kind === "text" ? (
            <div className="status-text-stage status-text-view" style={{ background: item.bgColor || "#5ef2c0" }}>
              <p>{item.text}</p>
            </div>
          ) : item.kind === "video" ? (
            <video
              ref={videoRef}
              src={mediaUrl(item.url)}
              className="status-media"
              autoPlay
              playsInline
              onTimeUpdate={onVideoTimeUpdate}
              onEnded={goNext}
            />
          ) : (
            <img src={mediaUrl(item.url)} alt="" className="status-media" />
          )}
          {item.caption && <div className="status-caption">{item.caption}</div>}
        </div>

        {isOwn && (
          <button className="status-viewer-footer" onClick={() => setShowViewers((s) => !s)}>
            <EyeIcon size={15} /> {item.viewerCount || 0} viewed
          </button>
        )}

        {showViewers && (
          <div className="status-viewers-list">
            {item.viewers?.length ? (
              item.viewers.map((v) => (
                <div className="status-viewers-row" key={v.user?._id || v.user}>
                  <Avatar user={v.user || {}} size={30} />
                  <span className="status-viewers-name">{v.user?.displayName || "Someone"}</span>
                  <span className="status-viewers-time">{formatClock(v.at)}</span>
                </div>
              ))
            ) : (
              <div className="status-viewers-row status-viewers-empty">No views yet</div>
            )}
          </div>
        )}
      </div>

      {confirmDeleteId && (
        <ConfirmModal
          title="Delete this status?"
          message="It will be removed for everyone immediately."
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>,
    document.body
  );
}
