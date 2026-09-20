import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import client from "../../api/client";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import Modal from "../common/Modal";
import AvatarCropModal from "./AvatarCropModal";
import { CameraIcon, CopyIcon } from "../common/Icons";

export default function ProfileModal({ onClose }) {
  const { user, setUser } = useAuth();
  const { showToast } = useToast();
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [about, setAbout] = useState(user.about || "");
  const [busy, setBusy] = useState(false);
  const [cropFile, setCropFile] = useState(null);

  function handleAvatarFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast("Avatar image must be under 5MB", "danger");
      return;
    }
    // Opens the square-crop tool instead of applying the raw file — the
    // avatar is only saved once the user confirms the crop and hits
    // "Save Profile Photo" in that modal.
    setCropFile(file);
  }

  async function saveAvatar(dataUrl) {
    try {
      const res = await client.patch("/users/profile", { avatar: dataUrl });
      setUser(res.data.user);
      showToast("Profile photo updated");
    } catch {
      showToast("Failed to update profile photo", "danger");
    }
  }

  async function handleSave() {
    setBusy(true);
    try {
      const res = await client.patch("/users/profile", { displayName, about });
      setUser(res.data.user);
      showToast("Profile saved");
      onClose();
    } catch {
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
    <>
      <Modal
        title="Profile"
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
            <span className="profile-avatar-hint">JPG, PNG or GIF · cropped to a square</span>
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
            <button type="button" className="btn btn-ghost btn-sm" onClick={copyUsername} title="Copy username">
              <CopyIcon size={14} /> Copy
            </button>
          </div>
        </div>
      </Modal>

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onSave={async (dataUrl) => {
            setCropFile(null);
            await saveAvatar(dataUrl);
          }}
        />
      )}
    </>
  );
}
