import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStatus } from "../../context/StatusContext";
import { useToast } from "../../context/ToastContext";
import ImageEditor from "../MediaComposer/ImageEditor";
import StatusCropper from "../MediaComposer/StatusCropper";
import ConfirmModal from "../common/ConfirmModal";
import { kindFromMime } from "../../utils/fileKind";
import { compressMedia, needsCompression, STATUS_IMAGE_TARGET_BYTES, STATUS_GIF_TARGET_BYTES } from "../../utils/mediaCompressor";
import { CloseIcon, SendIcon, BackIcon } from "../common/Icons";
import "../../styles/mediaComposer.css";
import "../../styles/status.css";
import "../../styles/e2ee.css";

const BG_COLORS = ["#5ef2c0", "#38bdf8", "#a78bfa", "#f5a65b", "#ff5c5c", "#111318"];

export default function StatusEditor({ mode, file, onClose }) {
  const { postTextStatus, postMediaStatus } = useStatus();
  const { showToast } = useToast();
  const [text, setText] = useState("");
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  const [compressState, setCompressState] = useState(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const editorRef = useRef(null);
  const cropperRef = useRef({ ready: false, getBlob: async () => null });
  const [cropped, setCropped] = useState(null); // { blob, url } once the 9:16 crop is confirmed
  const [videoFit, setVideoFit] = useState("cover");
  const [cropping, setCropping] = useState(false);

  const fileKind = file ? kindFromMime(file.type) : null;
  const fileUrl = useRef(file ? URL.createObjectURL(file) : null).current;
  // Animated GIFs can't be cropped on a canvas without freezing them, so they
  // skip the cropper and are letterboxed in the 9:16 viewer instead.
  const needsCrop = mode !== "text" && fileKind === "image" && file?.type !== "image/gif";
  const stage = mode === "text" ? "text" : needsCrop && !cropped ? "crop" : fileKind === "image" ? "edit" : "video";

  const onCropperChange = useCallback((api) => {
    cropperRef.current = api;
  }, []);

  useEffect(
    () => () => {
      if (cropped?.url) URL.revokeObjectURL(cropped.url);
    },
    [cropped]
  );

  async function confirmCrop() {
    if (cropping) return;
    setCropping(true);
    try {
      const blob = await cropperRef.current.getBlob();
      if (!blob) throw new Error("empty");
      setCropped({ blob, url: URL.createObjectURL(blob) });
    } catch {
      showToast("Couldn't crop that photo — try another one", "danger");
    } finally {
      setCropping(false);
    }
  }

  function requestClose() {
    if (text.trim() || caption.trim() || cropped) {
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
      } else {
        if (stage === "crop") {
          // Posting straight from the crop step: use the crop as-is.
          await confirmCrop();
          return;
        }
        let blob = cropped?.blob || file;
        let name = cropped ? "status.jpg" : file.name;
        if (fileKind === "image" && editorRef.current?.isEdited()) {
          blob = await editorRef.current.getFinalBlob();
          name = "status.png";
        }
        // Same compressor used for chat media, but with a noticeably
        // tighter target — status slides are viewed briefly and expire in
        // 24h, so it's worth trading a bit more quality for a much smaller,
        // faster-loading upload than a chat photo would use.
        if (needsCompression(blob)) {
          setCompressState({ progress: 0, label: fileKind === "video" ? "Compressing video" : "Optimizing photo" });
          const targetBytes = blob.type === "image/gif" ? STATUS_GIF_TARGET_BYTES : STATUS_IMAGE_TARGET_BYTES;
          blob = await compressMedia(blob, { targetBytes, onProgress: (p) => setCompressState((s) => ({ ...s, progress: p })) });
        }
        setCompressState(null);
        await postMediaStatus(blob, name, caption.trim(), fileKind === "video" ? videoFit : file?.type === "image/gif" ? "contain" : "cover");
      }
      showToast("Status posted");
      onClose();
    } catch (err) {
      showToast(err?.response?.data?.message || "Couldn't post your status — try again", "danger");
    } finally {
      setCompressState(null);
      setPosting(false);
    }
  }

  return createPortal(
    <div className="media-composer-overlay" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="media-composer status-editor">
        <div className="media-composer-header">
          <button className="icon-btn" onClick={requestClose} title="Cancel (Esc)">
            <CloseIcon size={20} />
          </button>
          <div className="media-composer-title">
            {mode === "text" ? "Text status" : "Add to status"}
          </div>
          {stage === "edit" && cropped ? (
            <button className="icon-btn" onClick={() => setCropped(null)} title="Back to crop">
              <BackIcon size={18} />
            </button>
          ) : (
            <div style={{ width: 36 }} />
          )}
        </div>

        <div className="media-composer-stage">
          {compressState && (
            <div className="compress-overlay">
              <div className="compress-spinner" />
              <div className="compress-label">{compressState.label}…</div>
              <div className="compress-bar-track">
                <div className="compress-bar-fill" style={{ width: `${Math.round(compressState.progress * 100)}%` }} />
              </div>
            </div>
          )}
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
          ) : stage === "crop" ? (
            <StatusCropper key={fileUrl} src={fileUrl} onChange={onCropperChange} />
          ) : stage === "edit" ? (
            <ImageEditor key={cropped?.url || fileUrl} ref={editorRef} originalUrl={cropped?.url || fileUrl} />
          ) : (
            <div className="status-video-frame">
              <video src={fileUrl} controls playsInline className="media-composer-preview-video" style={{ objectFit: videoFit }} />
              <div className="status-cropper-modes video-fit" role="tablist" aria-label="Framing">
                <button type="button" className={videoFit === "cover" ? "active" : ""} onClick={() => setVideoFit("cover")}>Fill 9:16</button>
                <button type="button" className={videoFit === "contain" ? "active" : ""} onClick={() => setVideoFit("contain")}>Fit</button>
              </div>
            </div>
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
          {mode !== "text" && stage !== "crop" && (
            <input
              className="media-composer-caption"
              placeholder="Add a caption…"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          )}
          <button
            className="btn btn-primary media-composer-send"
            disabled={posting || cropping || (mode === "text" && !text.trim())}
            onClick={stage === "crop" ? confirmCrop : handlePost}
          >
            {stage !== "crop" && <SendIcon size={16} />}
            <span>
              {stage === "crop"
                ? cropping
                  ? "Cropping…"
                  : "Next"
                : posting
                ? compressState
                  ? "Optimizing…"
                  : "Posting…"
                : "Share status"}
            </span>
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
    </div>,
    document.body
  );
}
