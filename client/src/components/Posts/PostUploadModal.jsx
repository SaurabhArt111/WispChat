import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "../common/Modal";
import { useToast } from "../../context/ToastContext";
import { createPost } from "../../api/posts";
import { ImageIcon } from "../common/Icons";
import "../../styles/posts.css";

export default function PostUploadModal({ onClose, onCreated, remaining }) {
  const { showToast } = useToast();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  async function submit() {
    if (!file || busy) return;
    setBusy(true);
    try {
      const post = await createPost(file, caption, setProgress);
      onCreated?.(post);
      showToast("Post shared", "success");
      onClose();
    } catch (err) {
      showToast(err?.response?.data?.message || "Upload failed. Try again.", "danger");
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New post"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!file || busy}>
            {busy ? `Uploading ${Math.round(progress * 100)}%` : "Share"}
          </button>
        </>
      }
    >
      <p className="post-upload-hint">
        {remaining} of 6 post slots left. Delete an old post to make room once you reach the limit.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />
      {previewUrl ? (
        <div className="post-upload-preview" onClick={() => !busy && inputRef.current?.click()}>
          {file.type.startsWith("video") ? (
            <video src={previewUrl} controls muted playsInline />
          ) : (
            <img src={previewUrl} alt="Preview" />
          )}
        </div>
      ) : (
        <button type="button" className="post-upload-pick" onClick={() => inputRef.current?.click()}>
          <ImageIcon size={30} />
          <span>Choose a photo or video</span>
        </button>
      )}
      <textarea
        className="input post-upload-caption"
        placeholder="Write a caption…"
        maxLength={500}
        rows={3}
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
      />
    </Modal>
  );
}
