import { useEffect, useRef, useState } from "react";
import EmojiPanel from "./EmojiPanel";
import { clearDraft, getDraft, saveDraft } from "../../utils/drafts";
import { useChat } from "../../context/ChatContext";
import { useSocket } from "../../context/SocketContext";
import { useAuth } from "../../context/AuthContext";
import { useDecryptedText } from "../../hooks/useDecryptedMessage";
import {
  SmileIcon,
  PaperclipIcon,
  SendIcon,
  CloseIcon,
  EditIcon,
  ReplyIcon,
  LockIcon,
} from "../common/Icons";

let typingTimeout = null;

export default function Composer({
  conversation,
  replyTo,
  onCancelReply,
  editingMessage,
  onCancelEdit,
  onSend,
  onAttachFiles,
}) {
  const { user } = useAuth();
  // Restore whatever was typed here but never sent (see utils/drafts.js).
  const [text, setText] = useState(() => getDraft(user._id, conversation._id));
  const [showEmoji, setShowEmoji] = useState(false);
  const [enterToSend, setEnterToSend] = useState(() => {
    const saved = localStorage.getItem("wisp_enter_send");
    return saved !== null ? saved === "true" : true;
  });

  const { editMessage } = useChat();
  const { socket } = useSocket();
  const { text: replyPreviewText, locked: replyLocked } = useDecryptedText(replyTo);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const emojiPopRef = useRef(null);
  const textRef = useRef(text);
  textRef.current = text;
  const editingRef = useRef(false);
  editingRef.current = !!editingMessage;
  const draftBeforeEditRef = useRef(null);
  const convId = conversation._id;

  // Persist the draft as you type (debounced), and flush it synchronously when
  // you leave — back button, switching chats, tab close — so nothing typed is
  // ever lost. Editing an old message never overwrites the draft.
  useEffect(() => {
    if (editingMessage) return undefined;
    const t = setTimeout(() => saveDraft(user._id, convId, text), 250);
    return () => clearTimeout(t);
  }, [text, editingMessage, user._id, convId]);

  useEffect(() => {
    const flush = () => {
      if (!editingRef.current) saveDraft(user._id, convId, textRef.current);
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [user._id, convId]);

  // The textarea's height must match a restored multi-line draft.
  useEffect(() => {
    if (textareaRef.current) autoGrow(textareaRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLockedForMe =
    conversation.isGroup &&
    conversation.onlyAdminsCanMessage &&
    !conversation.admins?.some((a) => (a._id || a) === user._id);

  // Sync enter-to-send changes from storage/settings
  useEffect(() => {
    function onStorage() {
      const saved = localStorage.getItem("wisp_enter_send");
      if (saved !== null) setEnterToSend(saved === "true");
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Focus textarea when editing or replying
  useEffect(() => {
    if (editingMessage) {
      if (draftBeforeEditRef.current === null) draftBeforeEditRef.current = textRef.current;
      setText(editingMessage.text || "");
      textareaRef.current?.focus();
    }
  }, [editingMessage]);

  // Leaving edit mode puts the in-progress draft back instead of wiping it.
  function endEdit() {
    const restored = draftBeforeEditRef.current ?? "";
    draftBeforeEditRef.current = null;
    setText(restored);
    if (textareaRef.current) {
      textareaRef.current.value = restored;
      autoGrow(textareaRef.current);
    }
  }

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  // Click outside listener for emoji picker
  useEffect(() => {
    if (!showEmoji) return;
    function onMouseDown(e) {
      if (emojiPopRef.current && !emojiPopRef.current.contains(e.target)) {
        setShowEmoji(false);
      }
    }
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [showEmoji]);

  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  function handleChange(e) {
    setText(e.target.value);
    autoGrow(e.target);
    if (!socket) return;
    socket.emit("typing:start", { conversationId: conversation._id });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit("typing:stop", { conversationId: conversation._id });
    }, 1500);
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    const value = text.trim();
    if (!value) return;

    if (editingMessage) {
      await editMessage(editingMessage._id, value);
      onCancelEdit();
      endEdit();
      return;
    }

    // Sent → the draft is done with.
    setText("");
    clearDraft(user._id, convId);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    socket?.emit("typing:stop", { conversationId: conversation._id });
    await onSend({ text: value, attachments: [], selfPreview: user });
  }

  function handleKeyDown(e) {
    if (enterToSend) {
      // Enter to send, Shift+Enter for new line
      if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleSubmit();
      }
    } else {
      // Ctrl+Enter or Cmd+Enter to send, Enter for new line
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmit();
      }
    }

    if (e.key === "Escape") {
      if (editingMessage) {
        onCancelEdit();
        endEdit();
      }
      if (replyTo) onCancelReply();
      if (showEmoji) setShowEmoji(false);
    }
  }

  function handleFileInput(e) {
    if (e.target.files?.length) onAttachFiles(e.target.files);
    e.target.value = "";
  }

  function toggleEnterToSend() {
    const next = !enterToSend;
    setEnterToSend(next);
    localStorage.setItem("wisp_enter_send", String(next));
  }

  const recipientName = conversation.isGroup
    ? conversation.name
    : conversation.participants?.find((p) => p._id !== user._id)?.displayName || "chat";

  if (isLockedForMe) {
    return (
      <div className="composer-wrap">
        <div className="composer-locked-banner">
          <LockIcon size={14} />
          <span>Only admins can send messages in this group</span>
        </div>
      </div>
    );
  }

  return (
    <div className="composer-wrap">
      {replyTo && !editingMessage && (
        <div className="composer-context-bar">
          <div className="composer-context-icon">
            <ReplyIcon size={14} />
          </div>
          <div className="composer-context-accent" />
          <div className="composer-context-body">
            <div className="composer-context-title">
              Replying to {replyTo.sender?.displayName || "message"}
            </div>
            <div className="composer-context-text">
              {replyLocked
                ? "🔒 Encrypted message"
                : replyPreviewText || (replyTo.attachments?.length ? "📎 Attachment" : "")}
            </div>
          </div>
          <button className="icon-btn btn-sm" onClick={onCancelReply} title="Cancel reply (Esc)">
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      {editingMessage && (
        <div className="composer-context-bar editing">
          <div className="composer-context-icon editing">
            <EditIcon size={14} />
          </div>
          <div className="composer-context-accent" />
          <div className="composer-context-body">
            <div className="composer-context-title">Editing message</div>
            <div className="composer-context-text">{editingMessage.text}</div>
          </div>
          <button
            className="icon-btn btn-sm"
            onClick={() => {
              onCancelEdit();
              endEdit();
            }}
            title="Cancel edit (Esc)"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      <div className="composer-layout">
        <form className="composer" id={`composer-form-${conversation._id}`} onSubmit={handleSubmit}>

          <div className="composer-input-container">
            <button
              type="button"
              className={`icon-btn ${showEmoji ? "active" : ""}`}
              title="Emoji picker"
              onClick={() => setShowEmoji((s) => !s)}
            >
              <SmileIcon size={20} />
            </button>

            <button
              type="button"
              className="icon-btn"
              title="Attach files (images, videos, docs)"
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon size={20} />
            </button>

            <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileInput} />

            <textarea
              ref={textareaRef}
              rows={1}
              placeholder={
                editingMessage
                  ? "Edit message…"
                  : `Message ${recipientName}…`
              }
              value={text}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              className={`enter-send-toggle ${enterToSend ? "active" : ""}`}
              onClick={toggleEnterToSend}
              aria-label={
                enterToSend
                  ? "Press Enter to send (Shift+Enter for new line). Click to change."
                  : "Press Ctrl+Enter to send (Enter for new line). Click to change."
              }
            >
              {enterToSend ? "↵" : "Ctrl+↵"}
            </button>

            <button
              type="submit"
              className="composer-send composer-send-mobile"
              disabled={!text.trim()}
              aria-label={`Send message (${enterToSend ? "Enter" : "Ctrl+Enter"})`}
            >
              <SendIcon size={17} />
            </button>
          </div>
        </form>

        <button
          type="submit"
          form={`composer-form-${conversation._id}`}
          className="composer-send composer-send-desktop"
          disabled={!text.trim()}
          aria-label={`Send message (${enterToSend ? "Enter" : "Ctrl+Enter"})`}
        >
          <SendIcon size={17} />
        </button>
      </div>

      {showEmoji && (
        <div className="emoji-popover" ref={emojiPopRef}>
          <EmojiPanel
            onEmoji={(emoji) => {
              setText((t) => t + emoji);
              textareaRef.current?.focus();
            }}
            onSticker={async (emoji) => {
              // Stickers go out immediately as a big, bubble-less emoji.
              setShowEmoji(false);
              await onSend({ text: emoji, attachments: [], selfPreview: user });
            }}
            onGif={async (url, title) => {
              try {
                const blob = await (await fetch(url)).blob();
                setShowEmoji(false);
                onAttachFiles([new File([blob], `${(title || "gif").replace(/[^\w-]+/g, "_").slice(0, 40)}.gif`, { type: blob.type || "image/gif" })]);
              } catch {
                /* network error — leave the panel open so they can retry */
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
