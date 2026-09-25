import { useEffect, useRef, useState } from "react";
import EmojiPicker, { EmojiStyle } from "emoji-picker-react";
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
  const [text, setText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [enterToSend, setEnterToSend] = useState(() => {
    const saved = localStorage.getItem("wisp_enter_send");
    return saved !== null ? saved === "true" : true;
  });

  const { editMessage } = useChat();
  const { socket } = useSocket();
  const { user } = useAuth();
  const { text: replyPreviewText, locked: replyLocked } = useDecryptedText(replyTo);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const emojiPopRef = useRef(null);

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
      setText(editingMessage.text || "");
      textareaRef.current?.focus();
    }
  }, [editingMessage]);

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
      setText("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      return;
    }

    setText("");
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
        setText("");
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
              setText("");
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
              title={
                enterToSend
                  ? "Press Enter to send (Shift+Enter for new line). Click to change."
                  : "Press Ctrl+Enter to send (Enter for new line). Click to change."
              }
            >
              {enterToSend ? "↵ Send" : "Ctrl+↵"}
            </button>
            <button
              type="submit"
              className="composer-send composer-send-mobile"
              disabled={!text.trim()}
              title={`Send message (${enterToSend ? "Enter" : "Ctrl+Enter"})`}
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
          title={`Send message (${enterToSend ? "Enter" : "Ctrl+Enter"})`}
        >
          <SendIcon size={17} />
        </button>
      </div>

      {showEmoji && (
        <div className="emoji-popover" ref={emojiPopRef}>
          <EmojiPicker
            theme="dark"
            // "native" renders the OS/browser's own emoji glyphs instead of
            // fetching PNGs from jsdelivr's CDN — avoids the picker being
            // silently broken by browser tracking-prevention (which blocks
            // that third-party CDN in Edge/Safari/Brave) and works offline
            // in the PWA build, since there's nothing left to fetch.
            emojiStyle={EmojiStyle.NATIVE}
            onEmojiClick={(e) => {
              setText((t) => t + e.emoji);
              textareaRef.current?.focus();
            }}
            width={340}
            height={390}
            previewConfig={{ showPreview: false }}
          />
        </div>
      )}
    </div>
  );
}
