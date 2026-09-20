import { useRef, useState } from "react";
import { useStatus } from "../../context/StatusContext";
import { useToast } from "../../context/ToastContext";
import ImageEditor from "../MediaComposer/ImageEditor";
import ConfirmModal from "../common/ConfirmModal";
import { kindFromMime } from "../../utils/fileKind";
import { CloseIcon, SendIcon } from "../common/Icons";
import "../../styles/mediaComposer.css";
import "../../styles/status.css";

const BG_COLORS = ["#5ef2c0", "#38bdf8", "#a78bfa", "#f5a65b", "#ff5c5c", "#111318"];

export default function StatusEditor({ mode, file, onClose }) {
  const { postTextStatus, postMediaStatus } = useStatus();
  const { showToast } = useToast();
  const [text, setText] = useState("");
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const editorRef = useRef(null);

  const fileKind = file ? kindFromMime(file.type) : null;
  const fileUrl = useRef(file ? URL.createObjectURL(file) : null).current;

  function requestClose() {
    if (text.trim() || caption.trim()) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }

  async function handlePost() {
    if (posting) return;
    setPosting(true);
    try {
      if (mode === "text") {
        if (!text.trim()) return;
        await postTextStatus(text.trim(), bgColor);
      } else if (fileKind === "image" && editorRef.current?.isEdited()) {
        const blob = await editorRef.current.getFinalBlob();
        await postMediaStatus(blob, "status.png", caption.trim());
      } else {
        await postMediaStatus(file, file.name, caption.trim());
      }
      showToast("Status posted");
      onClose();
    } catch {
      showToast("Couldn't post your status — try again", "danger");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="media-composer-overlay" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="media-composer status-editor">
        <div className="media-composer-header">
          <button className="icon-btn" onClick={requestClose} title="Cancel (Esc)">
            <CloseIcon size={20} />
          </button>
          <div className="media-composer-title">
            {mode === "text" ? "Text status" : "Add to status"}
          </div>
          <div style={{ width: 36 }} />
        </div>

        <div className="media-composer-stage">
          {mode === "text" ? (
            <div className="status-text-stage" style={{ background: bgColor }}>
              <textarea
                className="status-text-input"
                placeholder="Type a status…"
                maxLength={700}
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
            </div>
          ) : fileKind === "image" ? (
            <ImageEditor key={fileUrl} ref={editorRef} originalUrl={fileUrl} />
          ) : (
            <video src={fileUrl} controls className="media-composer-preview-video" />
          )}
        </div>

        {mode === "text" ? (
          <div className="status-color-row">
            {BG_COLORS.map((c) => (
              <button
                key={c}
                className={`status-color-swatch ${bgColor === c ? "active" : ""}`}
                style={{ background: c }}
                onClick={() => setBgColor(c)}
              />
            ))}
          </div>
        ) : null}

        <div className="media-composer-footer">
          {mode !== "text" && (
            <input
              className="media-composer-caption"
              placeholder="Add a caption…"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          )}
          <button
            className="btn btn-primary media-composer-send"
            disabled={posting || (mode === "text" && !text.trim())}
            onClick={handlePost}
          >
            <SendIcon size={16} />
            <span>{posting ? "Posting…" : "Share status"}</span>
          </button>
        </div>
      </div>

      {showDiscardConfirm && (
        <ConfirmModal
          title="Discard this status?"
          message="It hasn't been posted yet."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          danger
          onConfirm={onClose}
          onCancel={() => setShowDiscardConfirm(false)}
        />
      )}
    </div>
  );
}
