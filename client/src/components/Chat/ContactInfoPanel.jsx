import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { useToast } from "../../context/ToastContext";
import client from "../../api/client";
import Avatar from "../common/Avatar";
import Lightbox from "./Lightbox";
import GroupInfoModal from "./GroupInfoModal";
import { formatLastSeen, formatBytes } from "../../utils/time";
import {
  CloseIcon,
  MuteIcon,
  PinIcon,
  ArchiveIcon,
  UsersIcon,
  ImageIcon,
  FileIcon,
} from "../common/Icons";
import "../../styles/contactInfo.css";

const TABS = [
  { id: "media", label: "Media" },
  { id: "files", label: "Files" },
];

export default function ContactInfoPanel({ conversation, onClose }) {
  const { user } = useAuth();
  const { messages, presence, upsertConversation, closeActiveChat } = useChat();
  const { showToast } = useToast();
  const [tab, setTab] = useState("media");
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [showGroupSettings, setShowGroupSettings] = useState(false);

  const other = !conversation.isGroup
    ? conversation.participants?.find((p) => p._id !== user._id)
    : null;

  const label = conversation.isGroup ? conversation.name : other?.displayName || "Unknown";
  const avatarUser = conversation.isGroup
    ? { displayName: conversation.name, avatar: conversation.avatar, avatarColor: "#64748b" }
    : other;
  const isOnline = other ? presence[other._id]?.isOnline ?? other.isOnline : false;
  const lastSeen = other ? presence[other._id]?.lastSeen ?? other.lastSeen : null;

  const media = useMemo(
    () =>
      messages
        .flatMap((m) => (m.attachments || []).map((a) => ({ ...a, messageId: m._id })))
        .filter((a) => a.kind === "image" || a.kind === "video"),
    [messages]
  );
  const files = useMemo(
    () =>
      messages
        .flatMap((m) => (m.attachments || []).map((a) => ({ ...a, messageId: m._id })))
        .filter((a) => a.kind === "audio" || a.kind === "file"),
    [messages]
  );

  async function flag(name) {
    try {
      const res = await client.post(`/conversations/${conversation._id}/flag`, { flag: name });
      const key = { mute: "muted", pin: "pinned", archive: "archived" }[name];
      upsertConversation({ ...conversation, [key]: res.data[name + "d"] });
      showToast(`Chat ${res.data[name + "d"] ? name + "d" : "un" + name + "d"}`);
      if (name === "archive" && res.data.archived) {
        onClose();
        closeActiveChat();
      }
    } catch {
      showToast("Action failed", "danger");
    }
  }

  return (
    <aside className="contact-info-panel">
      <div className="contact-info-header">
        <span>{conversation.isGroup ? "Group info" : "Contact info"}</span>
        <button className="icon-btn" onClick={onClose} title="Close">
          <CloseIcon size={18} />
        </button>
      </div>

      <div className="contact-info-scroll">
        <div className="contact-info-hero">
          <Avatar user={avatarUser} size={96} showStatus={!conversation.isGroup} online={isOnline} />
          <div className="contact-info-name">{label}</div>
          <div className="contact-info-sub">
            {conversation.isGroup
              ? `${conversation.participants?.length || 0} members`
              : other?.username
              ? `@${other.username}`
              : ""}
          </div>
          {!conversation.isGroup && (
            <div className="contact-info-status">{formatLastSeen(lastSeen, isOnline)}</div>
          )}
          {!conversation.isGroup && other?.about && (
            <div className="contact-info-about">{other.about}</div>
          )}
        </div>

        <div className="contact-info-actions-row">
          <button className={`ci-action-btn ${conversation.muted ? "on" : ""}`} onClick={() => flag("mute")}>
            <MuteIcon size={17} />
            <span>{conversation.muted ? "Muted" : "Mute"}</span>
          </button>
          <button className={`ci-action-btn ${conversation.pinned ? "on" : ""}`} onClick={() => flag("pin")}>
            <PinIcon size={17} filled={conversation.pinned} />
            <span>{conversation.pinned ? "Pinned" : "Pin"}</span>
          </button>
          <button className="ci-action-btn" onClick={() => flag("archive")}>
            <ArchiveIcon size={17} />
            <span>Archive</span>
          </button>
          {conversation.isGroup && (
            <button className="ci-action-btn" onClick={() => setShowGroupSettings(true)}>
              <UsersIcon size={17} />
              <span>Members</span>
            </button>
          )}
        </div>

        {conversation.isGroup && (
          <div className="contact-info-members-preview">
            {conversation.participants?.slice(0, 6).map((p) => (
              <Avatar key={p._id} user={p} size={30} />
            ))}
            {conversation.participants?.length > 6 && (
              <div className="ci-member-more">+{conversation.participants.length - 6}</div>
            )}
          </div>
        )}

        <div className="contact-info-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`ci-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="ci-tab-count">{t.id === "media" ? media.length : files.length}</span>
            </button>
          ))}
        </div>

        {tab === "media" ? (
          media.length === 0 ? (
            <div className="ci-empty">
              <ImageIcon size={26} />
              <p>No shared photos or videos yet.</p>
            </div>
          ) : (
            <div className="ci-media-grid">
              {media.map((a, i) =>
                a.kind === "video" ? (
                  <video key={a.url + i} src={a.url} className="ci-media-thumb" muted />
                ) : (
                  <img
                    key={a.url + i}
                    src={a.url}
                    className="ci-media-thumb"
                    onClick={() =>
                      setLightboxIndex(media.filter((m) => m.kind === "image").findIndex((m) => m.url === a.url))
                    }
                  />
                )
              )}
            </div>
          )
        ) : files.length === 0 ? (
          <div className="ci-empty">
            <FileIcon size={26} />
            <p>No shared files yet.</p>
          </div>
        ) : (
          <div className="ci-files-list">
            {files.map((a, i) => (
              <a key={a.url + i} href={a.url} download={a.name} target="_blank" rel="noreferrer" className="ci-file-row">
                <div className="ci-file-icon">
                  <FileIcon size={16} />
                </div>
                <div className="ci-file-meta">
                  <div className="ci-file-name">{a.name}</div>
                  <div className="ci-file-size">{formatBytes(a.size)}</div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          images={media.filter((m) => m.kind === "image")}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      {showGroupSettings && (
        <GroupInfoModal conversation={conversation} onClose={() => setShowGroupSettings(false)} />
      )}
    </aside>
  );
}
