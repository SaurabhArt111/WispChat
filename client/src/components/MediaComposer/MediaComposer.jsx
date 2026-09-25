import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { kindFromMime } from "../../utils/fileKind";
import ImageEditor from "./ImageEditor";
import ConfirmModal from "../common/ConfirmModal";
import {
  CloseIcon,
  SendIcon,
  PlusIcon,
  ImageIcon,
  VideoIcon,
  AudioIcon,
  FileIcon as DocIcon,
} from "../common/Icons";
import "../../styles/mediaComposer.css";
import "../../styles/e2ee.css";

function buildItem(file) {
  return {
    id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
    file,
    kind: kindFromMime(file.type),
    url: URL.createObjectURL(file),
  };
}

export default function MediaComposer({ files, conversationLabel, onClose, onSend }) {
  const [items, setItems] = useState(() => files.map(buildItem));
  const [activeIndex, setActiveIndex] = useState(0);
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  // "Send as document" bypasses compression entirely and delivers the
  // original file bytes untouched — the WhatsApp-style escape hatch for
  // when you actually need the source quality/resolution to survive.
  const [asDocument, setAsDocument] = useState(false);
  const editorRefs = useRef({});
  const itemsRef = useRef(items);
  itemsRef.current = items;

  function revokeAll() {
    itemsRef.current.forEach((i) => URL.revokeObjectURL(i.url));
  }

  function closeComposer() {
    revokeAll();
    onClose();
  }

  // Anything typed in the caption, or edits made to an image (crop/draw/
  // rotate), counts as work the user could lose — so closing asks first.
  // A bare "attached files, nothing touched yet" state closes immediately.
  function requestClose() {
    const hasEdits = Object.values(editorRefs.current).some((ref) => ref?.isEdited?.());
    if (caption.trim() || hasEdits) {
      setShowDiscardConfirm(true);
    } else {
      closeComposer();
    }
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") requestClose();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, caption]);

  function addMoreFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    const added = Array.from(fileList).map(buildItem);
    setItems((prev) => [...prev, ...added]);
  }

  function removeItem(id) {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.url);
      const next = prev.filter((i) => i.id !== id);
      if (next.length === 0) onClose();
      return next;
    });
    setActiveIndex((idx) => Math.max(0, idx - 1));
  }

  const active = items[activeIndex];

  async function handleSend() {
    if (!active || sending) return;
    setSending(true);
    try {
      // Only bake in crop/rotate/draw edits here (fast, synchronous
      // canvas work). Compression/encryption/upload all happen in the
      // background after the composer closes — see ChatContext.
      // sendMediaMessage — so hitting Send feels instant, the same way
      // WhatsApp's send button doesn't wait around for a video to finish
      // transcoding before the message shows up as "sending" in the chat.
      const editedItems = await Promise.all(
        items.map(async (item) => {
          const editorRef = editorRefs.current[item.id];
          if (item.kind === "image" && editorRef?.isEdited()) {
            const blob = await editorRef.getFinalBlob();
            return {
              blob,
              name: item.file.name.replace(/\.\w+$/, "") + ".png",
              kind: "image",
            };
          }
          return { blob: item.file, name: item.file.name, kind: item.kind };
        })
      );

      revokeAll();
      onSend({ items: editedItems, caption: caption.trim(), asDocument });
      onClose();
    } finally {
      setSending(false);
    }
  }

  const totalLabel = useMemo(() => {
    if (items.length === 1) return items[0].file.name;
    return `${items.length} items queued`;
  }, [items]);

  if (!active) return null;

  return createPortal(
    <div
      className="media-composer-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
    >
      <div className="media-composer">
        <div className="media-composer-header">
          <button className="icon-btn" onClick={requestClose} title="Cancel (Esc)">
            <CloseIcon size={20} />
          </button>
          <div className="media-composer-title">
            Send to <strong>{conversationLabel}</strong>
            <span className="media-composer-subtitle">{totalLabel}</span>
          </div>
          <div style={{ width: 36 }} />
        </div>

        <div className="media-composer-stage">
          {active.kind === "image" ? (
            <ImageEditor
              key={active.id}
              ref={(el) => (editorRefs.current[active.id] = el)}
              originalUrl={active.url}
            />
          ) : active.kind === "video" ? (
            <video src={active.url} controls className="media-composer-preview-video" />
          ) : active.kind === "audio" ? (
            <div className="media-composer-generic-preview">
              <AudioIcon size={52} />
              <div>{active.file.name}</div>
              <audio src={active.url} controls />
            </div>
          ) : (
            <div className="media-composer-generic-preview">
              <DocIcon size={52} />
              <div>{active.file.name}</div>
              <div className="generic-file-size">
                {(active.file.size / 1024).toFixed(0)} KB
              </div>
            </div>
          )}
        </div>

        {items.length > 1 && (
          <div className="media-composer-strip">
            {items.map((item, i) => (
              <div
                key={item.id}
                className={`strip-thumb ${i === activeIndex ? "active" : ""}`}
              >
                <button type="button" onClick={() => setActiveIndex(i)}>
                  {item.kind === "image" ? (
                    <img src={item.url} alt="" />
                  ) : (
                    <div className="strip-thumb-generic">
                      {item.kind === "video" && <VideoIcon size={20} />}
                      {item.kind === "audio" && <AudioIcon size={20} />}
                      {item.kind !== "video" && item.kind !== "audio" && <DocIcon size={20} />}
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  className="strip-thumb-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeItem(item.id);
                  }}
                  title="Remove item"
                >
                  <CloseIcon size={10} />
                </button>
              </div>
            ))}
            <label className="strip-thumb strip-add" title="Add more files">
              <PlusIcon size={20} />
              <input
                type="file"
                multiple
                hidden
                onChange={(e) => addMoreFiles(e.target.files)}
              />
            </label>
          </div>
        )}

        <div className="media-composer-footer">
          <label className="document-mode-toggle">
            <input
              type="checkbox"
              checked={asDocument}
              onChange={(e) => setAsDocument(e.target.checked)}
            />
            Send without compression (as document)
          </label>
          <div className="media-composer-footer-row">
            <input
              className="media-composer-caption"
              placeholder="Add a caption… (Ctrl + Enter to send)"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
              }}
              autoFocus
            />
            <button
              className="btn btn-primary media-composer-send"
              disabled={sending}
              onClick={handleSend}
            >
              <SendIcon size={16} />
              <span>{sending ? "Sending…" : `Send${items.length > 1 ? ` (${items.length})` : ""}`}</span>
            </button>
          </div>
        </div>
      </div>

      {showDiscardConfirm && (
        <ConfirmModal
          title="Discard this message?"
          message="Your caption and any edits you made will be lost."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          danger
          onConfirm={closeComposer}
          onCancel={() => setShowDiscardConfirm(false)}
        />
      )}
    </div>,
    document.body
  );
}
