import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { useContextMenu } from "../../context/ContextMenuContext";
import { useToast } from "../../context/ToastContext";
import { useDecryptedText } from "../../hooks/useDecryptedMessage";
import Avatar from "../common/Avatar";
import ConfirmModal from "../common/ConfirmModal";
import { formatListTime } from "../../utils/time";
import client from "../../api/client";
import {
  PinIcon,
  MuteIcon,
  ArchiveIcon,
  TrashIcon,
  DoubleCheckIcon,
  CheckIcon,
  ImageIcon,
  VideoIcon,
  AudioIcon,
  FileIcon,
  LockIcon,
} from "../common/Icons";

// A component (not a plain function) specifically so it can decrypt the
// last message's text via a hook before showing it — an encrypted
// conversation's preview must never render raw ciphertext.
function ConversationPreview({ conv, selfId, isTyping }) {
  const msg = conv.lastMessage;
  const { text: decryptedText, locked } = useDecryptedText(msg);

  if (isTyping) {
    return (
      <span className="typing-preview">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-text">{typeof isTyping === "string" ? `${isTyping} is typing…` : "typing…"}</span>
      </span>
    );
  }

  if (!msg) return <span className="preview-muted">Say hello 👋</span>;
  if (msg.deletedForEveryone) return <span className="preview-deleted">🚫 Message was deleted</span>;

  const isMine = (msg.sender?._id || msg.sender) === selfId;
  const prefix = isMine ? "You: " : conv.isGroup ? `${msg.sender?.displayName?.split(" ")[0] || "Someone"}: ` : "";

  const bodyText = msg.encrypted ? (locked ? "Encrypted message" : decryptedText) : msg.text;

  if (msg.attachments?.length) {
    const kind = msg.attachments[0].kind;
    return (
      <span className="attachment-preview-text">
        {prefix}
        {/* {msg.encrypted && <LockIcon size={12} className="preview-icon" />} */}
        {kind === "image" && <ImageIcon size={14} className="preview-icon" />}
        {kind === "video" && <VideoIcon size={14} className="preview-icon" />}
        {kind === "audio" && <AudioIcon size={14} className="preview-icon" />}
        {kind !== "image" && kind !== "video" && kind !== "audio" && <FileIcon size={14} className="preview-icon" />}
        <span>{bodyText || (kind === "image" ? "Photo" : kind === "video" ? "Video" : kind === "audio" ? "Voice message" : "Attachment")}</span>
      </span>
    );
  }

  return (
    <span>
      {prefix}
      {/* {msg.encrypted && <LockIcon size={11} className="preview-icon" />} */}
      {bodyText}
    </span>
  );
}

export default function ConversationItem({ conversation, active, onClick }) {
  const { user } = useAuth();
  const { presence, typing, upsertConversation } = useChat();
  const { openMenu } = useContextMenu();
  const { showToast } = useToast();
  const [confirmClear, setConfirmClear] = useState(false);

  // Swipe-to-reveal-archive (mouse + touch, via Pointer Events so both
  // work through one code path). Dragging left slides the row over to
  // reveal an Archive button docked behind it; releasing past halfway
  // snaps it fully open, releasing before that snaps it back closed —
  // the same interaction Telegram/WhatsApp mobile use.
  const REVEAL_WIDTH = 84;
  // A real drag only starts once the pointer has moved a few px — a plain
  // tap (or the start of a long-press) must not be swallowed by the swipe
  // handler, and a plain tap must not be swallowed by the long-press timer
  // either. Both are decided lazily off the same pointerdown.
  const DRAG_SLOP = 6;
  const LONG_PRESS_MS = 480;
  const [dragX, setDragX] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pressed, setPressed] = useState(false);
  const dragStartRef = useRef(null); // { startX, startY, baseX, dragging }
  const longPressTimerRef = useRef(null);
  const suppressClickRef = useRef(false);

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function fireLongPressMenu(x, y) {
    suppressClickRef.current = true;
    setPressed(false);
    if (navigator.vibrate) {
      try {
        navigator.vibrate(10);
      } catch {}
    }
    handleContextMenu({
      clientX: x,
      clientY: y,
      preventDefault() {},
      stopPropagation() {},
    });
  }

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: revealed ? -REVEAL_WIDTH : 0,
      dragging: false,
      pointerId: e.pointerId,
    };
    setPressed(true);
    // Only touch/pen get the long-press-for-menu gesture — desktop already
    // has right-click for that, and holding the mouse button down is a
    // completely different (and much more common) motion to leave alone.
    if (e.pointerType !== "mouse") {
      clearLongPressTimer();
      longPressTimerRef.current = setTimeout(() => {
        const drag = dragStartRef.current;
        if (!drag || drag.dragging) return;
        dragStartRef.current = null;
        fireLongPressMenu(e.clientX, e.clientY);
      }, LONG_PRESS_MS);
    }
  }
  function onPointerMove(e) {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const deltaX = e.clientX - drag.startX;
    const deltaY = e.clientY - drag.startY;
    if (!drag.dragging) {
      // Any real movement cancels a pending long-press — it's a scroll or
      // a swipe now, not a hold. Only commit to the horizontal swipe once
      // the motion is clearly more horizontal than vertical, so a vertical
      // list-scroll started on top of a row doesn't get hijacked into it.
      if (Math.abs(deltaX) < DRAG_SLOP && Math.abs(deltaY) < DRAG_SLOP) return;
      clearLongPressTimer();
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        dragStartRef.current = null;
        setPressed(false);
        return; // vertical scroll — let the list handle it natively
      }
      drag.dragging = true;
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    e.preventDefault();
    const next = Math.min(0, Math.max(-REVEAL_WIDTH, drag.baseX + deltaX));
    setDragX(next);
  }
  function endDrag(e) {
    clearLongPressTimer();
    setPressed(false);
    const drag = dragStartRef.current;
    dragStartRef.current = null;
    if (!drag) return;
    if (!drag.dragging) {
      setDragging(false);
      return;
    }
    setDragging(false);
    try {
      e?.currentTarget?.releasePointerCapture?.(drag.pointerId);
    } catch {}
    setDragX((x) => {
      const open = x < -REVEAL_WIDTH / 2;
      setRevealed(open);
      return open ? -REVEAL_WIDTH : 0;
    });
  }
  function closeSwipe() {
    setRevealed(false);
    setDragX(0);
  }
  useEffect(() => clearLongPressTimer, []);

  function handleRowPointerLeave() {
    // A pointer that wanders off the row (drags outside, browser-cancels
    // the pointer, etc.) should drop a pending long-press rather than let
    // it fire on an element the finger isn't over anymore.
    if (dragStartRef.current && !dragStartRef.current.dragging) {
      clearLongPressTimer();
      dragStartRef.current = null;
      setPressed(false);
    }
  }

  const other = !conversation.isGroup
    ? conversation.participants?.find((p) => p._id !== user._id)
    : null;

  const label = conversation.isGroup ? conversation.name : other?.displayName || "Unknown";
  const avatarUser = conversation.isGroup
    ? { displayName: conversation.name, avatar: conversation.avatar, avatarColor: "#64748b" }
    : other;

  const isOnline = other ? presence[other._id]?.isOnline ?? other.isOnline : false;
  const isTyping = typing[conversation._id]
    ? Object.values(typing[conversation._id]).join(", ")
    : null;

  async function flag(name) {
    try {
      const res = await client.post(`/conversations/${conversation._id}/flag`, { flag: name });
      const key = { mute: "muted", pin: "pinned", archive: "archived" }[name];
      upsertConversation({ ...conversation, [key]: res.data[name + "d"] });
      showToast(`Chat ${res.data[name + "d"] ? name + "d" : "un" + name + "d"}`);
    } catch (err) {
      showToast("Action failed", "danger");
    }
  }

  function handleSwipeArchive() {
    closeSwipe();
    flag("archive");
  }

  function handleRowClick(e) {
    // A long-press already opened the action menu for this same gesture —
    // the pointerup that follows still synthesizes a click, and without
    // this guard it would immediately navigate into the chat right after.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      return;
    }
    // First tap while the archive action is revealed just closes it
    // again, matching the swipe-row convention elsewhere — it shouldn't
    // also navigate into the chat in the same tap.
    if (revealed) {
      closeSwipe();
      return;
    }
    onClick?.(e);
  }

  async function clearChat() {
    setConfirmClear(false);
    try {
      await client.post(`/conversations/${conversation._id}/clear`);
      showToast("Chat history cleared");
    } catch (err) {
      showToast("Could not clear chat", "danger");
    }
  }

  function handleContextMenu(e) {
    openMenu(
      e,
      [
        {
          label: conversation.pinned ? "Unpin chat" : "Pin chat",
          icon: <PinIcon size={15} filled={conversation.pinned} />,
          onClick: () => flag("pin"),
        },
        {
          label: conversation.muted ? "Unmute notifications" : "Mute notifications",
          icon: <MuteIcon size={15} />,
          onClick: () => flag("mute"),
        },
        {
          label: conversation.archived ? "Unarchive chat" : "Archive chat",
          icon: <ArchiveIcon size={15} />,
          onClick: () => flag("archive"),
        },
        { divider: true },
        { label: "Clear chat", danger: true, icon: <TrashIcon size={15} />, onClick: () => setConfirmClear(true) },
      ],
      label
    );
  }

  const isMineLast = conversation.lastMessage && (conversation.lastMessage.sender?._id || conversation.lastMessage.sender) === user._id;

  return (
    <>
    <div className="conv-swipe-wrap">
      <button
        className="conv-swipe-archive-btn"
        style={{ width: REVEAL_WIDTH }}
        onClick={handleSwipeArchive}
        title={conversation.archived ? "Unarchive" : "Archive"}
      >
        <ArchiveIcon size={20} />
        <span>{conversation.archived ? "Unarchive" : "Archive"}</span>
      </button>
      <button
        className={`conv-item ${active ? "active" : ""} ${conversation.pinned ? "is-pinned" : ""} ${
          pressed ? "is-pressed" : ""
        }`}
        onClick={handleRowClick}
        onContextMenu={handleContextMenu}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={handleRowPointerLeave}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging ? "none" : "transform 220ms var(--ease, ease)",
          touchAction: "pan-y",
        }}
      >
        <Avatar user={avatarUser} size={46} showStatus={!conversation.isGroup} online={isOnline} />
        <div className="conv-item-main">
          <div className="conv-item-row">
            <span className="conv-item-name">
              {label}
              {conversation.pinned && (
                <span className="pin-badge" title="Pinned">
                  <PinIcon size={12} filled />
                </span>
              )}
            </span>
            <span className="conv-item-time">{formatListTime(conversation.lastMessageAt)}</span>
          </div>
          <div className="conv-item-row">
            <span className={`conv-item-preview ${conversation.unreadCount ? "unread" : ""}`}>
              {isMineLast && !conversation.unreadCount && (
                <span className="preview-ticks">
                  {conversation.lastMessage?.readBy?.length > 1 ? (
                    <DoubleCheckIcon size={13} read />
                  ) : (
                    <CheckIcon size={12} />
                  )}
                </span>
              )}
              <ConversationPreview conv={conversation} selfId={user._id} isTyping={isTyping} />
            </span>
            <div className="conv-item-badges">
              {conversation.muted && (
                <span className="mute-badge" title="Muted">
                  <MuteIcon size={13} />
                </span>
              )}
              {conversation.unreadCount > 0 && (
                <span className="unread-badge">{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</span>
              )}
            </div>
          </div>
        </div>
      </button>
    </div>
    {confirmClear && (
      <ConfirmModal
        title="Clear this chat?"
        message="All messages in this chat will be removed for you. This can't be undone."
        confirmLabel="Clear chat"
        danger
        onConfirm={clearChat}
        onCancel={() => setConfirmClear(false)}
      />
    )}
    </>
  );
}
