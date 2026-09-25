import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { useToast } from "../../context/ToastContext";
import client from "../../api/client";
import { mediaUrl } from "../../api/config";
import Avatar from "../common/Avatar";
import Lightbox from "./Lightbox";
import GroupInfoModal from "./GroupInfoModal";
import { formatLastSeen, formatBytes } from "../../utils/time";
import { BackIcon, CloseIcon, MuteIcon, PinIcon, ArchiveIcon, UsersIcon, ImageIcon, FileIcon, LocateIcon } from "../common/Icons";
import { SafeImage, SafeVideo } from "../common/SafeMedia";
import "../../styles/contactInfo.css";

const TABS = [
  { id: "media", label: "Media" },
  { id: "files", label: "Files" },
];

const MIN_WIDTH = 280;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 320;

export default function ContactInfoPanel({ conversation, onClose }) {
  const { user } = useAuth();
  const { messages, presence, upsertConversation, closeActiveChat } = useChat();
  const { showToast } = useToast();
  const [tab, setTab] = useState("media");
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [width, setWidth] = useState(
    () => Number(localStorage.getItem("wisp_contact_panel_width")) || DEFAULT_WIDTH
  );
  const resizing = useRef(false);

  const startResize = useCallback((e) => {
    e.preventDefault();
    resizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    function onMove(e) {
      if (!resizing.current) return;
      // Panel sits on the right edge, so dragging left grows it: width is
      // measured from the cursor back to the window's right edge.
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - e.clientX));
      setWidth(next);
    }
    function onUp() {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth((w) => {
        localStorage.setItem("wisp_contact_panel_width", String(w));
        return w;
      });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

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

  // Scrolls the main message list to a message and briefly highlights it —
  // reuses the exact class MessageList's own jump-to-reply uses, so the
  // visual is identical whether you got here from a reply or from here.
  function jumpToMessage(msgId) {
    const el = document.getElementById(`msg-${msgId}`);
    if (!el) {
      showToast("That message is further back — scroll up in the chat to find it");
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("highlighted-bubble");
    setTimeout(() => el.classList.remove("highlighted-bubble"), 2000);
  }

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
    <aside className="contact-info-panel" style={{ width }}>
      <div className="contact-info-resize-handle" onMouseDown={startResize} title="Drag to resize" />
      <div className="contact-info-header">
        {/* Back button for mobile view */}
        <button
          className="icon-btn chat-header-back"
          onClick={onClose}
          title="Back to chat"
        >
          <BackIcon size={20} />
        </button>
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
          <button className="contact-info-members-preview" onClick={() => setShowGroupSettings(true)}>
            {conversation.participants?.slice(0, 6).map((p) => (
              <Avatar key={p._id} user={p} size={30} />
            ))}
            {conversation.participants?.length > 6 && (
              <div className="ci-member-more">+{conversation.participants.length - 6}</div>
            )}
          </button>
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
                  <div className="ci-media-cell" key={a.url + i}>
                    <SafeVideo src={mediaUrl(a.url)} className="ci-media-thumb" muted />
                    <button className="ci-locate-btn" title="Go to message" onClick={() => jumpToMessage(a.messageId)}>
                      <LocateIcon size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="ci-media-cell" key={a.url + i}>
                    <SafeImage
                      src={mediaUrl(a.url)}
                      className="ci-media-thumb"
                      onClick={() =>
                        setLightboxIndex(media.filter((m) => m.kind === "image").findIndex((m) => m.url === a.url))
                      }
                    />
                    <button className="ci-locate-btn" title="Go to message" onClick={() => jumpToMessage(a.messageId)}>
                      <LocateIcon size={13} />
                    </button>
                  </div>
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
              <div key={a.url + i} className="ci-file-row">
                <a href={mediaUrl(a.url)} download={a.name} target="_blank" rel="noreferrer" className="ci-file-link">
                  <div className="ci-file-icon">
                    <FileIcon size={16} />
                  </div>
                  <div className="ci-file-meta">
                    <div className="ci-file-name">{a.name}</div>
                    <div className="ci-file-size">{formatBytes(a.size)}</div>
                  </div>
                </a>
                <button className="ci-locate-btn static" title="Go to message" onClick={() => jumpToMessage(a.messageId)}>
                  <LocateIcon size={14} />
                </button>
              </div>
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
