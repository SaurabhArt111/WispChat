import React, { useEffect, useRef, useState } from "react";
import { useContextMenu } from "../../context/ContextMenuContext";
import { useToast } from "../../context/ToastContext";
import { useDecryptedText } from "../../hooks/useDecryptedMessage";
import useDoubleTap from "../../hooks/useDoubleTap";
import { formatClock } from "../../utils/time";
import { LockIcon } from "../common/Icons";
import Avatar from "../common/Avatar";
import ActionSheetModal from "../common/ActionSheetModal";
import AttachmentView from "./AttachmentView";
import QuickReactions from "./QuickReactions";
import ForwardModal from "./ForwardModal";
import LinkPreviewCard, { linkPreviewsEnabled } from "./LinkPreviewCard";
import { mediaUrl } from "../../api/config";
import { extractUrls, isEmojiOnly, isUrlToken, makeUrlRegex, splitTrailing, toHref } from "../../utils/linkify";
import {
  ReplyIcon,
  CopyIcon,
  ForwardIcon,
  EditIcon,
  TrashIcon,
  CheckIcon,
  DoubleCheckIcon,
  ClockIcon,
  AlertIcon,
  SmileIcon,
  PhoneIcon,
  VideoIcon,
} from "../common/Icons";

const URL_SRC = makeUrlRegex().source;
const QUICK_EMOJI = ["❤️", "😂", "👍", "🔥", "😮", "🙏"];

function FormattedText({ text }) {
  if (!text) return null;

  // Split by code blocks ```...```
  const parts = text.split(/(```[\s\S]*?```)/g);

  return (
    <div className="bubble-text">
      {parts.map((part, index) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const codeContent = part.slice(3, -3).replace(/^\n/, "");
          return (
            <div key={index} className="code-block-container">
              <div className="code-block-header">
                <span>Code</span>
                <button
                  type="button"
                  className="code-copy-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(codeContent);
                  }}
                  title="Copy code"
                >
                  <CopyIcon size={12} /> Copy
                </button>
              </div>
              <pre className="code-block">
                <code>{codeContent}</code>
              </pre>
            </div>
          );
        }

        // Inline formatting: links, `inline code`, *bold*, _italic_
        const inlineRegex = new RegExp(`(${URL_SRC}|\`[^\`]+\`|\\*[^*]+\\*|_[^_]+_)`, "gi");
        const inlineParts = part.split(inlineRegex);

        return (
          <span key={index}>
            {inlineParts.map((sub, i) => {
              if (isUrlToken(sub)) {
                const { url, trailing } = splitTrailing(sub);
                return (
                  <React.Fragment key={i}>
                    <a
                      href={toHref(url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bubble-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {url}
                    </a>
                    {trailing}
                  </React.Fragment>
                );
              }
              if (sub.startsWith("`") && sub.endsWith("`") && sub.length > 2) {
                return (
                  <code key={i} className="inline-code">
                    {sub.slice(1, -1)}
                  </code>
                );
              }
              if (sub.startsWith("*") && sub.endsWith("*") && sub.length > 2) {
                return <strong key={i}>{sub.slice(1, -1)}</strong>;
              }
              if (sub.startsWith("_") && sub.endsWith("_") && sub.length > 2) {
                return <em key={i}>{sub.slice(1, -1)}</em>;
              }
              return sub;
            })}
          </span>
        );
      })}
    </div>
  );
}

// "Replying to status" quote shown on top of a comment/reaction that was sent
// to someone's status — a snapshot, so it still renders after the 24 h status
// has expired.
function StatusReplyQuote({ reply, isMine }) {
  const label = isMine ? "You replied to a status" : "Replied to your status";
  return (
    <div className="bubble-status-quote" title="Status">
      <div className="bubble-status-quote-text">
        <span className="bubble-status-quote-label">{label}</span>
        <span className="bubble-status-quote-body">
          {reply.kind === "text" ? reply.text : reply.caption || (reply.kind === "video" ? "🎥 Video" : "📷 Photo")}
        </span>
      </div>
      {reply.kind === "text" ? (
        <div className="bubble-status-quote-thumb text" style={{ background: reply.bgColor || "#5ef2c0" }}>Aa</div>
      ) : reply.kind === "video" ? (
        <video className="bubble-status-quote-thumb" src={`${mediaUrl(reply.url)}#t=0.1`} preload="metadata" muted playsInline />
      ) : (
        <img className="bubble-status-quote-thumb" src={mediaUrl(reply.url)} alt="" loading="lazy" />
      )}
    </div>
  );
}

function MessageBubble({
  message,
  isMine,
  grouped,
  isGroup,
  onReply,
  onEdit,
  onJumpToMessage,
  isHighlighted,
  userId,
  reactToMessage,
  requestDeleteMessage,
  undoDeleteMessage,
  selectMode = false,
  isSelected = false,
  onStartSelect,
  onToggleSelect,
}) {
  // NOTE: this component is React.memo'd and deliberately does NOT read
  // useChat()/useAuth() itself — a context subscription would re-render every
  // mounted bubble on any chat update (typing, presence, unread counts),
  // which is what made long chats feel laggy. The few things it needs from
  // those contexts come in as props from MessageList instead.
  const { openMenu } = useContextMenu();
  const { showToast } = useToast();
  const [showForward, setShowForward] = useState(false);
  const [showQuickReact, setShowQuickReact] = useState(false);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const reactPopRef = useRef(null);
  const { text: decryptedText, locked: textLocked } = useDecryptedText(message);
  const { text: replyDecryptedText, locked: replyLocked } = useDecryptedText(message.replyTo);
  // The first link in a message gets a rich preview card (WhatsApp-style).
  const linkPreview = React.useMemo(
    () => (decryptedText && linkPreviewsEnabled() ? extractUrls(decryptedText)[0] || null : null),
    [decryptedText]
  );

  useEffect(() => {
    if (!showQuickReact) return;
    function onDown(e) {
      if (reactPopRef.current && !reactPopRef.current.contains(e.target)) {
        setShowQuickReact(false);
      }
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [showQuickReact]);

  // Double-tap / double-click on a message:
  //   • on the bubble itself  → pop the quick-reaction bar
  //   • on the empty part of the row → reply to that message
  const doubleTap = useDoubleTap({
    onDouble: (_pt, e) => {
      if (selectMode || message.pending || message.failed) return;
      try {
        window.getSelection?.()?.removeAllRanges();
      } catch {
        /* ignore */
      }
      if (e?.target?.closest?.(".bubble-stack")) setShowQuickReact(true);
      else onReply?.(message);
    },
  });

  if (message.deletedForEveryone) {
    return (
      <div
        id={`msg-${message._id}`}
        className={`bubble-row ${isMine ? "mine" : ""} ${grouped ? "grouped" : ""}`}
      >
        {!isMine && isGroup && (
          <div className="bubble-avatar-slot">
            {!grouped && <Avatar user={message.sender} size={28} />}
          </div>
        )}
        <div className="bubble deleted">
          <span className="deleted-icon">🚫</span> This message was deleted
        </div>
      </div>
    );
  }

  if (message.callInfo?.kind && message.callInfo?.status) {
    const { kind, status, durationSec } = message.callInfo;
    const icon = kind === "video" ? <VideoIcon size={13} /> : <PhoneIcon size={13} />;
    const label =
      status === "completed"
        ? `${kind === "video" ? "Video" : "Voice"} call · ${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, "0")}`
        : status === "missed"
        ? `Missed ${kind === "video" ? "video" : "voice"} call`
        : `${kind === "video" ? "Video" : "Voice"} call declined`;
    return (
      <div className="call-summary-row">
        <span className={`call-summary-pill ${status}`}>
          {icon}
          {label}
        </span>
      </div>
    );
  }

  if (message.pendingDelete) {
    return (
      <div
        id={`msg-${message._id}`}
        className={`bubble-row ${isMine ? "mine" : ""} ${grouped ? "grouped" : ""}`}
      >
        {!isMine && isGroup && (
          <div className="bubble-avatar-slot">
            {!grouped && <Avatar user={message.sender} size={28} />}
          </div>
        )}
        <div className="bubble deleted pending-delete">
          <ClockIcon size={13} /> Deleting…
        </div>
      </div>
    );
  }

  function copyText() {
    if (!decryptedText) return;
    navigator.clipboard.writeText(decryptedText).then(() => showToast("Copied to clipboard"));
  }

  function confirmDelete(forEveryone) {
    setShowDeleteSheet(false);
    requestDeleteMessage(message._id, forEveryone);
    showToast(
      forEveryone ? "Message deleted for everyone" : "Message deleted",
      "default",
      {
        actionLabel: "Undo",
        onAction: () => undoDeleteMessage(message._id),
        duration: 3000,
      }
    );
  }

  const menuItems = [
    { label: "Reply", icon: <ReplyIcon size={15} />, onClick: () => onReply?.(message) },
    { label: "Copy", icon: <CopyIcon size={15} />, onClick: copyText, disabled: !decryptedText },
    { label: "Forward", icon: <ForwardIcon size={15} />, onClick: () => setShowForward(true) },
    { label: "Select", icon: <CheckIcon size={15} />, onClick: () => onStartSelect?.(message._id) },
    isMine && !message.pending
      ? {
          label: "Edit",
          icon: <EditIcon size={15} />,
          onClick: () => onEdit?.(message, decryptedText),
          disabled: !!message.attachments?.length || textLocked,
        }
      : null,
    { divider: true },
    {
      label: "Delete",
      danger: true,
      icon: <TrashIcon size={15} />,
      onClick: () => setShowDeleteSheet(true),
    },
  ].filter(Boolean);

  const myReaction = message.reactions?.find(
    (r) => (r.user?._id || r.user) === userId
  )?.emoji;

  function handleContextMenu(e) {
    openMenu(e, menuItems, null, {
      reactions: {
        emojis: QUICK_EMOJI,
        current: myReaction,
        onPick: (emoji) => reactToMessage(message._id, emoji),
      },
    });
  }

  const reactionCounts = {};
  (message.reactions || []).forEach((r) => {
    reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
  });

  return (
    <div
      id={`msg-${message._id}`}
      className={`bubble-row ${isMine ? "mine" : ""} ${grouped ? "grouped" : ""} ${
        isHighlighted ? "highlighted-bubble" : ""
      } ${selectMode ? "select-mode" : ""} ${isSelected ? "is-selected" : ""}`}
      onContextMenu={selectMode ? (e) => e.preventDefault() : handleContextMenu}
      // In select mode any tap (even on links/images) just toggles selection.
      onClickCapture={
        selectMode
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelect?.(message._id);
            }
          : undefined
      }
      {...(selectMode ? {} : doubleTap)}
    >
      {selectMode && (
        <span className={`select-check ${isSelected ? "on" : ""}`} aria-hidden="true">
          {isSelected && <CheckIcon size={14} />}
        </span>
      )}
      {!isMine && isGroup && (
        <div className="bubble-avatar-slot">
          {!grouped && <Avatar user={message.sender} size={28} />}
        </div>
      )}

      <div className="bubble-stack">
        <div
          className={`bubble ${isMine ? "mine" : "theirs"} ${
            message.pending ? "pending" : ""
          } ${message.failed ? "failed" : ""}`}
        >
          {!isMine && isGroup && !grouped && (
            <div className="bubble-sender" style={{ color: message.sender?.avatarColor || "var(--wisp)" }}>
              {message.sender?.displayName || "Member"}
            </div>
          )}

          {message.forwardedFrom && (
            <div className="bubble-forwarded">
              <ForwardIcon size={12} /> Forwarded
            </div>
          )}

          {message.replyTo && (
            <button
              type="button"
              className="bubble-reply-preview"
              onClick={() => onJumpToMessage?.(message.replyTo._id)}
              title="Jump to quoted message"
            >
              <div className="bubble-reply-line" />
              <div className="bubble-reply-content">
                <span className="bubble-reply-name">
                  {message.replyTo.sender?.displayName || "Message"}
                </span>
                <span className="bubble-reply-text">
                  {message.replyTo.deletedForEveryone
                    ? "Message deleted"
                    : replyLocked
                    ? "🔒 Encrypted message"
                    : replyDecryptedText ||
                      (message.replyTo.attachments?.length ? "📎 Attachment" : "")}
                </span>
              </div>
            </button>
          )}

          {message.statusReply && <StatusReplyQuote reply={message.statusReply} isMine={isMine} />}

          {message.attachments?.length > 0 && (
            <AttachmentView
              message={message}
              attachments={message.attachments}
              onForward={() => setShowForward(true)}
              onReply={() => onReply?.(message)}
              onDeleteRequest={() => setShowDeleteSheet(true)}
            />
          )}

          {/* Link card sits ABOVE the text, like WhatsApp */}
          {!textLocked && decryptedText && linkPreview && <LinkPreviewCard href={linkPreview} />}

          {textLocked ? (
            <div className="bubble-text encrypted-locked-text">
              <LockIcon size={12} /> Encrypted message — unlock to view
            </div>
          ) : message.statusReply?.isReaction && decryptedText ? (
            <div className="status-reaction-bubble">{decryptedText}</div>
          ) : isEmojiOnly(decryptedText) && !message.attachments?.length ? (
            <div className="bubble-emoji-only">{decryptedText.trim()}</div>
          ) : (
            decryptedText && <FormattedText text={decryptedText} />
          )}

          <div className="bubble-meta">
            {message.encrypted && (
              <span className="e2ee-badge" title="End-to-end encrypted">
                <LockIcon size={11} />
              </span>
            )}
            {message.edited && <span className="bubble-edited">edited</span>}
            <span className="bubble-time">{formatClock(message.createdAt)}</span>
            {isMine && !message.pending && (
              <span
                className={`bubble-ticks ${message.readBy?.length > 1 ? "read" : ""}`}
                title={
                  message.readBy?.length > 1
                    ? "Read"
                    : message.deliveredTo?.length > 1
                    ? "Delivered"
                    : "Sent"
                }
              >
                {message.readBy?.length > 1 ? (
                  <DoubleCheckIcon size={14} read />
                ) : message.deliveredTo?.length > 1 ? (
                  <DoubleCheckIcon size={14} />
                ) : (
                  <CheckIcon size={13} />
                )}
              </span>
            )}
            {message.pending && (
              <span className="bubble-ticks" title="Sending">
                <ClockIcon size={12} />
              </span>
            )}
            {message.failed && (
              <span className="bubble-ticks failed-mark" title="Failed to send">
                <AlertIcon size={13} />
              </span>
            )}
          </div>

          <button
            className="bubble-react-trigger"
            onClick={(e) => {
              e.stopPropagation();
              setShowQuickReact((s) => !s);
            }}
            title="Add reaction"
          >
            <SmileIcon size={14} />
          </button>

          <button
            className="bubble-forward-trigger"
            onClick={(e) => {
              e.stopPropagation();
              setShowForward(true);
            }}
            title="Forward"
          >
            <ForwardIcon size={14} />
          </button>

          {showQuickReact && (
            <div ref={reactPopRef}>
              <QuickReactions
                emojis={QUICK_EMOJI}
                current={myReaction}
                onPick={(emoji) => {
                  reactToMessage(message._id, emoji);
                  setShowQuickReact(false);
                }}
                align={isMine ? "right" : "left"}
              />
            </div>
          )}
        </div>

        {Object.keys(reactionCounts).length > 0 && (
          <div className={`reaction-pills ${isMine ? "mine" : ""}`}>
            {Object.entries(reactionCounts).map(([emoji, count]) => (
              <button
                key={emoji}
                className={`reaction-pill ${myReaction === emoji ? "active" : ""}`}
                onClick={() => reactToMessage(message._id, emoji)}
                title={`React with ${emoji}`}
              >
                <span>{emoji}</span>
                {count > 1 && <span className="reaction-count">{count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {showForward && (
        <ForwardModal message={message} onClose={() => setShowForward(false)} />
      )}

      {showDeleteSheet && (
        <ActionSheetModal
          title="Delete message?"
          actions={[
            isMine && {
              label: "Delete for everyone",
              danger: true,
              icon: <TrashIcon size={16} />,
              onClick: () => confirmDelete(true),
            },
            {
              label: "Delete for me",
              danger: true,
              icon: <TrashIcon size={16} />,
              onClick: () => confirmDelete(false),
            },
          ].filter(Boolean)}
          onCancel={() => setShowDeleteSheet(false)}
        />
      )}
    </div>
  );
}

export default React.memo(MessageBubble);
