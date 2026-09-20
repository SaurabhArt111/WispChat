import { useEffect, useRef, useState } from "react";
import { useStatus } from "../../context/StatusContext";
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
  const rafRef = useRef(null);
  const startRef = useRef(null);
  const pausedAtRef = useRef(0);
  const videoRef = useRef(null);

  const item = entry.items[index];

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

  return (
    <div className="status-viewer-overlay">
      <div className="status-viewer-stage">
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
          onMouseDown={() => setPaused(true)}
          onMouseUp={() => setPaused(false)}
          onTouchStart={() => setPaused(true)}
          onTouchEnd={() => setPaused(false)}
        >
          {item.kind === "text" ? (
            <div className="status-text-stage status-text-view" style={{ background: item.bgColor || "#5ef2c0" }}>
              <p>{item.text}</p>
            </div>
          ) : item.kind === "video" ? (
            <video
              ref={videoRef}
              src={item.url}
              className="status-media"
              autoPlay
              playsInline
              onTimeUpdate={onVideoTimeUpdate}
              onEnded={goNext}
            />
          ) : (
            <img src={item.url} alt="" className="status-media" />
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
                <div className="status-viewers-row" key={v.user}>
                  {formatClock(v.at)}
                </div>
              ))
            ) : (
              <div className="status-viewers-row">No views yet</div>
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
    </div>
  );
}
