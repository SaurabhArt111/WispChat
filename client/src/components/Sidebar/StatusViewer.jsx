import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStatus } from "../../context/StatusContext";
import { mediaUrl } from "../../api/config";
import Avatar from "../common/Avatar";
import ConfirmModal from "../common/ConfirmModal";
import { SafeImage, SafeVideo } from "../common/SafeMedia";
import { CloseIcon, TrashIcon, EyeIcon } from "../common/Icons";
import { formatClock } from "../../utils/time";
import "../../styles/status.css";

const IMAGE_DURATION = 5000;
const STATUS_REACTIONS = ["❤️", "😂", "😮", "🔥", "🎉", "👍"];

export default function StatusViewer({ entry, isOwn, onClose }) {
  const { markViewed, deleteStatus, reactToStatus } = useStatus();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showViewers, setShowViewers] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [reactionTrayOpen, setReactionTrayOpen] = useState(false);
  const [reactionTrayOffset, setReactionTrayOffset] = useState(0);
  const [sentReactions, setSentReactions] = useState({});
  const rafRef = useRef(null);
  const startRef = useRef(null);
  const pausedAtRef = useRef(0);
  const videoRef = useRef(null);
  const gestureRef = useRef(null);
  const contentRef = useRef(null);

  const item = entry.items[index];

  // One unified pointer-gesture handler drives both left/right tap-to-
  // navigate and swipe-down-to-dismiss, on the same surface, instead of
  // routing them through separate overlapping elements (which is what let
  // the old two invisible nav buttons block the dismiss drag whenever it
  // started over them). The gesture direction is decided lazily off the
  // first few pixels of movement, so a tap doesn't get mistaken for a
  // drag and a drag doesn't get mistaken for a tap:
  //  - barely moved, released quickly → tap: left third = prev, right
  //    third = next, middle = no-op (matches the original tap zones).
  //  - moved mostly downward → dismiss drag: content follows the finger
  //    1:1 and fades out, closing past a small release threshold with no
  //    extra hold, second tap, or delay, and snapping back otherwise.
  //  - moved mostly sideways with no real vertical component → ignored,
  //    so it can't be confused with either gesture.
  const TAP_SLOP = 10;
  const DISMISS_CLOSE_AT = 90;

  function gestureStart(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    gestureRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      direction: null, // 'tap' | 'vertical' | 'horizontal' once decided
      startTime: performance.now(),
    };
  }
  function gestureMove(e) {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.direction) {
      if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        g.direction = "vertical";
        setPaused(true);
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } else {
        g.direction = "horizontal";
      }
    }
    if (g.direction === "vertical") {
      e.preventDefault();
      if (dy < 0) {
        const nextOffset = Math.min(110, Math.abs(dy));
        if (isOwn) {
          setShowViewers(true);
        } else {
          setReactionTrayOpen(true);
          setReactionTrayOffset(nextOffset);
        }
        setDragY(0);
        return;
      }
      if (reactionTrayOpen) {
        const nextOffset = Math.min(110, Math.abs(dy));
        setReactionTrayOffset(nextOffset);
        if (dy > 70) {
          setReactionTrayOpen(false);
          setReactionTrayOffset(0);
        }
        return;
      }
      setDragY(Math.max(0, dy));
    }
  }
  function gestureEnd(e) {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    if (g.direction === "vertical") {
      setPaused(false);
      if (reactionTrayOpen) {
        const shouldKeepOpen = reactionTrayOffset > 30;
        if (isOwn && shouldKeepOpen) setShowViewers(true);
        setReactionTrayOpen(shouldKeepOpen);
        setReactionTrayOffset(0);
        return;
      }
      if (dragY > DISMISS_CLOSE_AT) {
        onClose();
      } else {
        setDragY(0);
      }
      return;
    }
    if (g.direction === null) {
      const rect = contentRef.current?.getBoundingClientRect();
      if (rect) {
        const relX = (e.clientX - rect.left) / rect.width;
        if (relX < 0.35) goPrev();
        else if (relX > 0.65) goNext();
        else {
          setPaused((p) => !p);
          if (isOwn) setShowViewers(true);
        }
      }
    }
  }
  function gestureCancel() {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (g?.direction === "vertical") {
      setPaused(false);
      setDragY(0);
      setReactionTrayOffset(0);
      if (reactionTrayOpen && reactionTrayOffset < 30) setReactionTrayOpen(false);
    }
  }

  async function handleReactionPick(emoji) {
    try {
      await reactToStatus(item._id, emoji);
    } catch {
      return;
    }
    setSentReactions((current) => ({ ...current, [item._id]: emoji }));
    setPaused(true);
    setReactionTrayOpen(false);
    setReactionTrayOffset(0);
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
  }, [index, item?.kind]);

  useEffect(() => {
    if (item?.kind === "video" || paused) return; // video progress is driven by timeupdate
    const duration = IMAGE_DURATION;

    function tick(ts) {
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
  }, [index, item?.kind, paused]);

  useEffect(() => {
    if (paused) {
      pausedAtRef.current = startRef.current === null
        ? progress * IMAGE_DURATION
        : performance.now() - startRef.current;
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

  const viewerRows = (item.viewers || []).map((viewer) => ({ ...viewer, emoji: viewer.emoji || null }));
  const myReaction = sentReactions[item._id] || item.myReaction;

  return createPortal(
    <div className="status-viewer-overlay" onWheel={handleWheel}>
      <div
        className="status-viewer-stage"
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          opacity: dragY ? Math.max(0.4, 1 - dragY / 260) : 1,
          transition: gestureRef.current?.direction === "vertical" ? "none" : "transform 160ms var(--ease), opacity 160ms var(--ease)",
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

        <div
          ref={contentRef}
          className="status-viewer-content"
          onPointerDown={gestureStart}
          onPointerMove={gestureMove}
          onPointerUp={gestureEnd}
          onPointerCancel={gestureCancel}
          style={{ touchAction: "pan-x" }}
        >
          {item.kind === "text" ? (
            <div className="status-text-stage status-text-view" style={{ background: item.bgColor || "#5ef2c0" }}>
              <p>{item.text}</p>
            </div>
          ) : item.kind === "video" ? (
            <SafeVideo
              ref={videoRef}
              src={mediaUrl(item.url)}
              className="status-media"
              autoPlay
              playsInline
              onTimeUpdate={onVideoTimeUpdate}
              onEnded={goNext}
            />
          ) : (
            <SafeImage src={mediaUrl(item.url)} alt="" className="status-media" draggable={false} />
          )}
          {item.caption && <div className="status-caption">{item.caption}</div>}
          {!isOwn && myReaction && (
            <div className="status-reaction-confirmation">
              <span>You reacted</span>
              <span aria-label={`Your reaction: ${myReaction}`}>{myReaction}</span>
            </div>
          )}
        </div>

        {isOwn && (
          <button className="status-viewer-footer" onClick={() => setShowViewers((s) => !s)}>
            <EyeIcon size={15} /> {item.viewerCount || 0} viewed
          </button>
        )}

        {showViewers && (
          <div className="status-viewers-list">
            {viewerRows.length ? (
              Array.from(
                viewerRows.reduce((byUser, viewer) => {
                  const id = String(viewer.user?._id || viewer.user || "local-user");
                  const existing = byUser.get(id);
                  byUser.set(
                    id,
                    existing
                      ? {
                          ...viewer,
                          count: (existing.count || 1) + (viewer.count || 1),
                          at: new Date(existing.at) > new Date(viewer.at) ? existing.at : viewer.at,
                          emoji: viewer.emoji || existing.emoji || null,
                        }
                      : { ...viewer, count: viewer.count || 1 }
                  );
                  return byUser;
                }, new Map()).values()
              ).map((v) => (
                <div className="status-viewers-row" key={`${v.user?._id || v.user || "local-user"}-${v.emoji || "view"}`}>
                  <Avatar user={v.user || {}} size={30} />
                  <span className="status-viewers-name">{v.user?.displayName || "Someone"}</span>
                  {v.emoji && <span className="status-viewers-reaction" aria-label={`Reacted with ${v.emoji}`}>{v.emoji}</span>}
                  <span className="status-viewers-count">
                    {v.count > 1 ? `watched ${v.count}` : "1 view"}
                  </span>
                  <span className="status-viewers-time">{formatClock(v.at)}</span>
                </div>
              ))
            ) : (
              <div className="status-viewers-row status-viewers-empty">No views yet</div>
            )}
          </div>
        )}

        {!isOwn && (
          <div
            className={`status-reaction-bar ${reactionTrayOpen ? "open" : ""}`}
            style={{ transform: `translate(-50%, ${reactionTrayOpen ? 0 : 120 + reactionTrayOffset}px)` }}
          >
            <div className="status-reaction-handle" />
            {STATUS_REACTIONS.map((emoji) => (
              <button key={emoji} className="status-reaction-pill" onClick={() => handleReactionPick(emoji)}>
                {emoji}
              </button>
            ))}
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
