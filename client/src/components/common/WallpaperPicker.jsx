import { useRef, useState } from "react";
import Modal from "./Modal";
import { WALLPAPER_PRESETS } from "../../utils/wallpaper";

// Shared picker UI for both the global default (Settings → Chats) and a
// per-chat override (chat header → More → Chat wallpaper). `value` is the
// currently-applied wallpaper id or a "data:" URL; `onChange` is called
// immediately as the person picks (no separate "save" step, same as the
// accent-theme picker), so this also works fine rendered inline instead of
// in a modal.
export default function WallpaperPicker({ value, onChange, allowInherit, onClose, asModal }) {
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      alert("Wallpaper image must be under 6MB");
      return;
    }
    setBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      onChange(reader.result);
      setBusy(false);
    };
    reader.onerror = () => setBusy(false);
    reader.readAsDataURL(file);
  }

  const isCustom = typeof value === "string" && value.startsWith("data:");

  const body = (
    <div className="wallpaper-picker">
      {allowInherit && (
        <button
          type="button"
          className={`wallpaper-swatch wallpaper-swatch-inherit ${!value ? "active" : ""}`}
          onClick={() => onChange("")}
        >
          <span>Use default</span>
        </button>
      )}
      {WALLPAPER_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`wallpaper-swatch ${value === p.id || (!value && !allowInherit && p.id === "none") ? "active" : ""}`}
          style={p.css && p.css !== "doodle" ? { backgroundImage: p.css } : p.id === "doodle" ? { backgroundColor: "#0d1512" } : undefined}
          onClick={() => onChange(p.id)}
          title={p.label}
        >
          {p.id === "none" && <span>None</span>}
        </button>
      ))}
      <button
        type="button"
        className={`wallpaper-swatch wallpaper-swatch-custom ${isCustom ? "active" : ""}`}
        style={isCustom ? { backgroundImage: `url(${value})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
      >
        {!isCustom && <span>{busy ? "…" : "+ Upload"}</span>}
      </button>
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFile} />
    </div>
  );

  if (!asModal) return body;

  return (
    <Modal title="Chat wallpaper" onClose={onClose}>
      <p className="modal-hint">Pick a background for this chat, or upload your own photo.</p>
      {body}
    </Modal>
  );
}
