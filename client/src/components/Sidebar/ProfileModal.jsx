import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import client from "../../api/client";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import Modal from "../common/Modal";
import { CameraIcon, CopyIcon, SparklesIcon } from "../common/Icons";

const ACCENTS = [
  { id: "default", name: "Mint Emerald", color: "#5ef2c0" },
  { id: "cyan", name: "Electric Cyan", color: "#38bdf8" },
  { id: "violet", name: "Cyber Violet", color: "#a78bfa" },
  { id: "ember", name: "Sunset Ember", color: "#f5a65b" },
];

export default function ProfileModal({ onClose }) {
  const { user, setUser } = useAuth();
  const { showToast } = useToast();
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [about, setAbout] = useState(user.about || "");
  const [busy, setBusy] = useState(false);
  const [currentAccent, setCurrentAccent] = useState(
    () => localStorage.getItem("wisp_accent") || "default"
  );
  const [enterToSend, setEnterToSend] = useState(() => {
    const saved = localStorage.getItem("wisp_enter_send");
    return saved !== null ? saved === "true" : true;
  });

  function handleAvatarFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast("Avatar image must be under 5MB", "danger");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => saveAvatar(reader.result);
    reader.readAsDataURL(file);
  }

  async function saveAvatar(dataUrl) {
    try {
      const res = await client.patch("/users/profile", { avatar: dataUrl });
      setUser(res.data.user);
      showToast("Avatar updated");
    } catch (err) {
      showToast("Failed to update avatar", "danger");
    }
  }

  function handleSetAccent(id) {
    setCurrentAccent(id);
    localStorage.setItem("wisp_accent", id);
    if (id === "default") {
      document.documentElement.removeAttribute("data-accent");
    } else {
      document.documentElement.setAttribute("data-accent", id);
    }
  }

  function handleToggleEnterSend(e) {
    const checked = e.target.checked;
    setEnterToSend(checked);
    localStorage.setItem("wisp_enter_send", String(checked));
  }

  async function handleSave() {
    setBusy(true);
    try {
      const res = await client.patch("/users/profile", { displayName, about });
      setUser(res.data.user);
      showToast("Profile saved");
      onClose();
    } catch (err) {
      showToast("Failed to save profile", "danger");
    } finally {
      setBusy(false);
    }
  }

  function copyUsername() {
    navigator.clipboard.writeText(`@${user.username}`).then(() => {
      showToast("Username copied to clipboard");
    });
  }

  return (
    <Modal
      title="Profile & Settings"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={busy} onClick={handleSave}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      }
    >
      <div className="profile-avatar-row">
        <Avatar user={user} size={76} showStatus online />
        <div className="profile-avatar-actions">
          <label className="btn btn-ghost btn-sm">
            <CameraIcon size={16} /> Change photo
            <input type="file" accept="image/*" hidden onChange={handleAvatarFile} />
          </label>
          <span className="profile-avatar-hint">JPG, PNG or GIF up to 5MB</span>
        </div>
      </div>

      <div className="field">
        <label>Display name</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your full name"
          maxLength={50}
        />
      </div>

      <div className="field">
        <label>About</label>
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          maxLength={140}
          rows={2}
          placeholder="A short bio or status message…"
        />
      </div>

      <div className="field">
        <label>Username</label>
        <div className="username-input-row">
          <input value={`@${user.username}`} disabled />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={copyUsername}
            title="Copy username"
          >
            <CopyIcon size={14} /> Copy
          </button>
        </div>
      </div>

      <div className="field">
        <label>
          <span>Chat Preferences</span>
        </label>
        <label className="preference-toggle-row">
          <input
            type="checkbox"
            checked={enterToSend}
            onChange={handleToggleEnterSend}
          />
          <div>
            <div className="preference-title">Press Enter to Send</div>
            <div className="preference-desc">
              When checked, Enter sends messages and Shift+Enter adds a new line. Uncheck to use Ctrl+Enter to send.
            </div>
          </div>
        </label>
      </div>

      <div className="field">
        <label>
          <span>App Accent Theme</span>
          <SparklesIcon size={14} style={{ color: "var(--wisp)" }} />
        </label>
        <div className="theme-accent-picker">
          {ACCENTS.map((accent) => (
            <button
              type="button"
              key={accent.id}
              className={`theme-accent-btn ${currentAccent === accent.id ? "active" : ""}`}
              onClick={() => handleSetAccent(accent.id)}
            >
              <span className="theme-accent-dot" style={{ background: accent.color }} />
              <span>{accent.name}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
