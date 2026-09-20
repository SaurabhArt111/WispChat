import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { useContextMenu } from "../../context/ContextMenuContext";
import { useToast } from "../../context/ToastContext";
import { formatClock } from "../../utils/time";
import Avatar from "../common/Avatar";
import ActionSheetModal from "../common/ActionSheetModal";
import AttachmentView from "./AttachmentView";
import QuickReactions from "./QuickReactions";
import ForwardModal from "./ForwardModal";
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
} from "../common/Icons";

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
        const inlineRegex = /(https?:\/\/[^\s]+|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
        const inlineParts = part.split(inlineRegex);

        return (
          <span key={index}>
            {inlineParts.map((sub, i) => {
              if (sub.startsWith("http://") || sub.startsWith("https://")) {
                return (
                  <a
                    key={i}
                    href={sub}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bubble-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {sub}
                  </a>
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

export default function MessageBubble({
  message,
  isMine,
  grouped,
  isGroup,
  onReply,
  onEdit,
  onJumpToMessage,
  isHighlighted,
}) {
  const { user } = useAuth();
  const { reactToMessage, requestDeleteMessage, undoDeleteMessage } = useChat();
  const { openMenu } = useContextMenu();
  const { showToast } = useToast();
  const [showForward, setShowForward] = useState(false);
  const [showQuickReact, setShowQuickReact] = useState(false);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const reactPopRef = useRef(null);

  useEffect(() => {
    if (!showQuickReact) return;
    function onDown(e) {
      if (reactPopRef.current && !reactPopRef.current.contains(e.target)) {
        setShowQuickReact(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [showQuickReact]);

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
    if (!message.text) return;
    navigator.clipboard.writeText(message.text).then(() => showToast("Copied to clipboard"));
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
    { label: "Copy", icon: <CopyIcon size={15} />, onClick: copyText, disabled: !message.text },
    { label: "Forward", icon: <ForwardIcon size={15} />, onClick: () => setShowForward(true) },
    isMine && !message.pending
      ? {
          label: "Edit",
          icon: <EditIcon size={15} />,
          onClick: () => onEdit?.(message),
          disabled: !!message.attachments?.length,
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
    (r) => (r.user?._id || r.user) === user._id
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
      }`}
      onContextMenu={handleContextMenu}
    >
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
                    : message.replyTo.text ||
                      (message.replyTo.attachments?.length ? "📎 Attachment" : "")}
                </span>
              </div>
            </button>
          )}

          {message.attachments?.length > 0 && (
            <AttachmentView
              attachments={message.attachments}
              onForward={() => setShowForward(true)}
              onReply={() => onReply?.(message)}
              onDeleteRequest={() => setShowDeleteSheet(true)}
            />
          )}

          {message.text && <FormattedText text={message.text} />}

          <div className="bubble-meta">
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
