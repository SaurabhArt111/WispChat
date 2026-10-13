import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { useContextMenu } from "../../context/ContextMenuContext";
import { useToast } from "../../context/ToastContext";
import { useDecryptedText } from "../../hooks/useDecryptedMessage";
import Avatar from "../common/Avatar";
import ConfirmModal from "../common/ConfirmModal";
import AddToFolderSheet from "./AddToFolderSheet";
import { formatListTime } from "../../utils/time";
import { getDraft, subscribeDrafts } from "../../utils/drafts";
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
  FolderIcon,
  InfoIcon,
} from "../common/Icons";

// Tiny haptic helper. navigator.vibrate exists on Android/Chromium phones; it
// is a harmless no-op on desktop and iOS Safari.
function buzz(pattern = 8) {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

// Live draft text for one chat (updates when the Composer saves/clears it).
function useDraft(userId, conversationId) {
  const [draft, setDraft] = useState(() => getDraft(userId, conversationId));
  useEffect(() => {
    setDraft(getDraft(userId, conversationId));
    return subscribeDrafts((id) => {
      if (id === null || id === conversationId) setDraft(getDraft(userId, conversationId));
    });
  }, [userId, conversationId]);
  return draft;
}

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
  const { presence, typing, upsertConversation, viewConversationInfo, deleteChat } = useChat();
  const { openMenu } = useContextMenu();
  const { showToast } = useToast();
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showFolderSheet, setShowFolderSheet] = useState(false);

  // Swipe-to-reveal-archive (mouse + touch, via Pointer Events so both
  // work through one code path). Dragging left slides the row over to
  // reveal an Archive button docked behind it; releasing past halfway
  // snaps it fully open, releasing before that snaps it back closed —
  // the same interaction Telegram/WhatsApp mobile use.
  // Left swipe reveals [Pin | Archive] — keep dragging past FULL_TRIGGER and
  // letting go archives the chat outright (Telegram-style, with Undo). Right
  // swipe reveals [Mute]. Fast, light flicks are ignored by a higher slop and
  // a "must be clearly horizontal" check so scrolling the list never opens
  // a row by accident.
  const ACTION_W = 80;
  const REVEAL_LEFT = ACTION_W * 2; // Pin + Archive
  const REVEAL_RIGHT = ACTION_W; // Mute
  const FULL_TRIGGER = 230;
  const MAX_LEFT = 300;
  const DRAG_SLOP = 10;
  const LONG_PRESS_MS = 480;
  const [dragX, setDragX] = useState(0);
  const [rest, setRest] = useState(0); // resting offset: 0 | -REVEAL_LEFT | +REVEAL_RIGHT
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [pressed, setPressed] = useState(false);
  const dragStartRef = useRef(null); // { startX, startY, baseX, dragging }
  const longPressTimerRef = useRef(null);
  const suppressClickRef = useRef(false);
  const dragXRef = useRef(0);
  const zoneRef = useRef("closed"); // magnet zone the finger is currently in
  const lastDragEndRef = useRef(0);
  const [snapPulse, setSnapPulse] = useState(0); // bumps on every magnet "click" so CSS can pop the buttons
  const revealed = rest !== 0;
  const MAGNET = 16; // px radius in which a resting point "grabs" the row
  const draftText = useDraft(user._id, conversation._id);

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
    // Edge touches belong to the app-level tab swipe, not the row actions.
    if (e.pointerType === "touch" && (e.clientX < 28 || e.clientX > window.innerWidth - 28)) return;
    zoneRef.current = rest < 0 ? "open-left" : rest > 0 ? "open-right" : "closed";
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: rest,
      dragging: false,
      pointerId: e.pointerId,
    };
    setPressed(true);
    // Only touch/pen get the long-press-for-menu gesture — desktop already
    // has right-click for that.
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
      if (Math.abs(deltaX) < DRAG_SLOP && Math.abs(deltaY) < DRAG_SLOP) return;
      clearLongPressTimer();
      // Commit to a swipe only when it is clearly horizontal.
      if (Math.abs(deltaY) * 1.2 > Math.abs(deltaX)) {
        dragStartRef.current = null;
        setPressed(false);
        return;
      }
      drag.dragging = true;
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    e.preventDefault();
    // A second mouse button pressed mid-drag (e.g. right-click) must neither
    // cancel the drag nor open the context menu — just keep following.
    let next = drag.baseX + deltaX;
    // Rubber-band beyond the reveal width so it feels physical.
    if (next < -REVEAL_LEFT) next = -REVEAL_LEFT + (next + REVEAL_LEFT) * 0.75;
    if (next > REVEAL_RIGHT) next = REVEAL_RIGHT + (next - REVEAL_RIGHT) * 0.3;
    next = Math.max(-MAX_LEFT, Math.min(REVEAL_RIGHT + 24, next));

    // Magnetic detents: the row "sticks" a little at each resting point
    // (closed, Pin+Archive open, Mute open) and at the full-swipe-to-archive
    // point, and buzzes the moment it locks in or lets go.
    let zone = "free";
    const detents = [
      ["closed", 0],
      ["open-left", -REVEAL_LEFT],
      ["open-right", REVEAL_RIGHT],
      ["armed", -FULL_TRIGGER],
    ];
    for (const [name, at] of detents) {
      if (Math.abs(next - at) < MAGNET) {
        next = at + (next - at) * 0.3; // strong pull toward the detent
        zone = name;
        break;
      }
    }
    if (next <= -FULL_TRIGGER) zone = "armed";
    if (zone !== "free" && zone !== zoneRef.current) {
      buzz(zone === "armed" ? [12, 30, 18] : zone === "closed" ? 5 : 10);
      setSnapPulse((n) => n + 1);
    }
    if (zone !== "free") zoneRef.current = zone;
    else if (zoneRef.current === "armed" && next > -FULL_TRIGGER) zoneRef.current = "free";
    dragXRef.current = next;
    setDragX(next);
  }
  function endDrag(e) {
    // Releasing/pressing the right button must not end a left-button drag.
    if (e?.pointerType === "mouse" && e.type === "pointerup" && e.button === 2) return;
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
    lastDragEndRef.current = Date.now();
    try {
      e?.currentTarget?.releasePointerCapture?.(drag.pointerId);
    } catch {}
    const x = dragXRef.current;
    if (x <= -FULL_TRIGGER) {
      // Full swipe → archive (or unarchive from the Archived page).
      buzz([16, 40, 24]);
      setLeaving(true);
      setDragX(-480);
      setTimeout(() => handleSwipeArchive(), 180);
      return;
    }
    const target = x < -REVEAL_LEFT / 2 ? -REVEAL_LEFT : x > REVEAL_RIGHT / 2 ? REVEAL_RIGHT : 0;
    if (target !== 0) buzz(10); // settle "thunk" as the buttons lock open
    setRest(target);
    setDragX(target);
  }
  function closeSwipe() {
    setRest(0);
    setDragX(0);
  }
  useEffect(() => clearLongPressTimer, []);
  // If the row is reused for another chat (virtual lists), reset it.
  useEffect(() => {
    setRest(0);
    setDragX(0);
    setLeaving(false);
  }, [conversation._id, conversation.archived]);

  function handleRowPointerLeave() {
    // A pointer that wanders off the row should drop a pending long-press.
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

  const FLAG_KEY = { mute: "muted", pin: "pinned", archive: "archived" };

  // Optimistic: the list updates the instant you act (no waiting on the
  // network), and rolls back with a message if the server says no.
  async function setFlag(name, value) {
    const key = FLAG_KEY[name];
    const previous = !!conversation[key];
    upsertConversation({ _id: conversation._id, [key]: value });
    try {
      await client.post(`/conversations/${conversation._id}/flag`, { flag: name, value });
      return true;
    } catch {
      upsertConversation({ _id: conversation._id, [key]: previous });
      showToast("Action failed — please try again", "danger");
      return false;
    }
  }

  async function flag(name) {
    const key = FLAG_KEY[name];
    const next = !conversation[key];
    const ok = await setFlag(name, next);
    if (!ok) return;
    const verb = { pin: next ? "Chat pinned" : "Chat unpinned", mute: next ? "Chat muted" : "Chat unmuted", archive: next ? "Chat archived" : "Chat unarchived" }[name];
    showToast(verb, "default", {
      actionLabel: "Undo",
      duration: 4500,
      onAction: () => setFlag(name, !next),
    });
  }

  function handleSwipeArchive() {
    setLeaving(false);
    closeSwipe();
    flag("archive");
  }

  function handleSwipePin() {
    closeSwipe();
    flag("pin");
  }

  function handleSwipeMute() {
    closeSwipe();
    flag("mute");
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

  async function deleteThisChat() {
    setConfirmDelete(false);
    try {
      await deleteChat(conversation._id);
      showToast("Chat deleted");
    } catch {
      showToast("Could not delete chat", "danger");
    }
  }

  function handleContextMenu(e) {
    // Right-click while a swipe is in progress (or the instant after one):
    // swallow it. Otherwise the menu flashes open for a split second and the
    // row freezes half-open.
    if (dragStartRef.current?.dragging || Date.now() - lastDragEndRef.current < 350) {
      e.preventDefault?.();
      e.stopPropagation?.();
      return;
    }
    if (rest !== 0) closeSwipe();
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
        {
          label: conversation.folder ? `Folder: ${conversation.folder}` : "Add to folder",
          icon: <FolderIcon size={15} />,
          onClick: () => setShowFolderSheet(true),
        },
        {
          label: "View info",
          icon: <InfoIcon size={15} />,
          onClick: () => viewConversationInfo(conversation._id),
        },
        { divider: true },
        { label: "Clear chat", danger: true, icon: <TrashIcon size={15} />, onClick: () => setConfirmClear(true) },
        { label: "Delete chat", danger: true, icon: <TrashIcon size={15} />, onClick: () => setConfirmDelete(true) },
      ],
      label
    );
  }

  const isMineLast = conversation.lastMessage && (conversation.lastMessage.sender?._id || conversation.lastMessage.sender) === user._id;

  return (
    <>
    <div className={`conv-swipe-wrap ${leaving ? "is-leaving" : ""} ${dragging ? "is-dragging" : ""}`} data-snap={snapPulse % 2}>
      {/* Right-swipe action: Mute */}
      <div className="conv-swipe-actions left" style={{ width: Math.max(REVEAL_RIGHT, dragX), visibility: dragX > 0 || rest > 0 ? "visible" : "hidden" }} aria-hidden={rest <= 0}>
        <button className="conv-swipe-btn mute" onClick={handleSwipeMute} tabIndex={rest > 0 ? 0 : -1}>
          <MuteIcon size={20} />
          <span>{conversation.muted ? "Unmute" : "Mute"}</span>
        </button>
      </div>
      {/* Left-swipe actions: Pin + Archive (archive grows as you drag further) */}
      <div className="conv-swipe-actions right" style={{ width: Math.max(REVEAL_LEFT, -dragX), visibility: dragX < 0 || rest < 0 ? "visible" : "hidden" }} aria-hidden={rest >= 0}>
        <button className="conv-swipe-btn pin" onClick={handleSwipePin} tabIndex={rest < 0 ? 0 : -1}>
          <PinIcon size={20} filled={conversation.pinned} />
          <span>{conversation.pinned ? "Unpin" : "Pin"}</span>
        </button>
        <button
          className={`conv-swipe-btn archive ${-dragX >= FULL_TRIGGER ? "armed" : ""}`}
          onClick={handleSwipeArchive}
          tabIndex={rest < 0 ? 0 : -1}
        >
          <ArchiveIcon size={20} />
          <span>{conversation.archived ? "Unarchive" : "Archive"}</span>
        </button>
      </div>
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
          transition: dragging
            ? "none"
            : rest !== 0
            ? "transform 340ms cubic-bezier(.22,1.35,.36,1)" /* springy settle when locking open */
            : "transform 260ms cubic-bezier(.2,.8,.2,1)",
          touchAction: "pan-y",
        }}
      >
        <Avatar user={avatarUser} size={46} showStatus={!conversation.isGroup} online={isOnline} />
        <div className="conv-item-main">
          <div className="conv-item-row">
            <span className="conv-item-name">
              {label}
              {conversation.folder && <span className="conv-folder-tag">{conversation.folder}</span>}
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
              {isMineLast && !conversation.unreadCount && !(draftText && !active) && (
                <span className="preview-ticks">
                  {conversation.lastMessage?.readBy?.length > 1 ? (
                    <DoubleCheckIcon size={13} read />
                  ) : (
                    <CheckIcon size={12} />
                  )}
                </span>
              )}
              {draftText && !active && !isTyping ? (
                <span className="conv-draft">
                  <span className="conv-draft-label">Draft:</span> {draftText}
                </span>
              ) : (
                <ConversationPreview conv={conversation} selfId={user._id} isTyping={isTyping} />
              )}
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
    {confirmDelete && (
      <ConfirmModal
        title="Delete this chat?"
        message="This removes the chat and its history from your list. Other people in it keep their copy, and it comes back if someone messages you again."
        confirmLabel="Delete chat"
        danger
        onConfirm={deleteThisChat}
        onCancel={() => setConfirmDelete(false)}
      />
    )}
    {showFolderSheet && (
      <AddToFolderSheet conversation={conversation} onClose={() => setShowFolderSheet(false)} />
    )}
    </>
  );
}
