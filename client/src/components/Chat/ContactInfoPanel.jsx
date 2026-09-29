import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { useStatus } from "../../context/StatusContext";
import { useToast } from "../../context/ToastContext";
import client from "../../api/client";
import { mediaUrl } from "../../api/config";
import Avatar from "../common/Avatar";
import Lightbox from "./Lightbox";
import GroupInfoModal from "./GroupInfoModal";
import StatusViewer from "../Sidebar/StatusViewer";
import { formatLastSeen, formatBytes } from "../../utils/time";
import { MuteIcon, PinIcon, ArchiveIcon, UsersIcon, ImageIcon, FileIcon, LocateIcon, PhoneIcon, VideoIcon, LockIcon, AlertIcon } from "../common/Icons";
import { useCall } from "../../context/CallContext";
import ConfirmModal from "../common/ConfirmModal";
import ProfileHero from "../Profile/ProfileHero";
import useCollapsingHero from "../../hooks/useCollapsingHero";
import { SafeImage, SafeVideo } from "../common/SafeMedia";
import PostsGrid from "../Posts/PostsGrid";
import "../../styles/contactInfo.css";

const TABS = [
  { id: "media", label: "Media" },
  { id: "files", label: "Files" },
];

// Direct chats also get a "Posts" tab (that person's Explorer posts).
const POSTS_TAB = { id: "posts", label: "Posts" };

const MIN_WIDTH = 280;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 320;

export default function ContactInfoPanel({ conversation, onClose }) {
  const { user } = useAuth();
  const { messages, presence, upsertConversation, closeActiveChat } = useChat();
  const { contactEntries } = useStatus();
  const { showToast } = useToast();
  const [tab, setTab] = useState("media");
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [showStatusViewer, setShowStatusViewer] = useState(false);
  const [width, setWidth] = useState(
    () => Number(localStorage.getItem("wisp_contact_panel_width")) || DEFAULT_WIDTH
  );
  const resizing = useRef(false);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const { call: activeCall, startCall } = useCall();
  // Big avatar → compact toolbar as the page scrolls (see profileHero.css).
  useCollapsingHero(panelRef, scrollRef);

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
  const contactStatusEntry = other ? contactEntries.find((f) => f.user._id === other._id) : null;

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
    <aside className="contact-info-panel ci-collapse" style={{ width }} ref={panelRef}>
      <div className="contact-info-resize-handle" onMouseDown={startResize} title="Drag to resize" />

      <ProfileHero
        person={avatarUser}
        title={label}
        subtitle={
          conversation.isGroup
            ? `${conversation.participants?.length || 0} members`
            : other?.username
              ? `@${other.username}`
              : ""
        }
        detail={!conversation.isGroup ? formatLastSeen(lastSeen, isOnline) : ""}
        onBack={onClose}
        onClose={onClose}
        onAvatarClick={contactStatusEntry ? () => setShowStatusViewer(true) : undefined}
        avatarHint={contactStatusEntry ? "View status" : undefined}
      />

      <div className="contact-info-scroll" ref={scrollRef}>
        <div className="ci-hero-spacer" />

        {!conversation.isGroup && other?.about && (
          <div className="ci-card">
            <span className="ci-card-label">About</span>
            <p className="ci-card-text">{other.about}</p>
          </div>
        )}

        {!conversation.isGroup && (
          <div className="ci-call-row">
            <button className="ci-call-tile" disabled={!!activeCall} onClick={() => startCall(conversation, "audio")}>
              <PhoneIcon size={19} />
              <span>Audio</span>
            </button>
            <button className="ci-call-tile" disabled={!!activeCall} onClick={() => startCall(conversation, "video")}>
              <VideoIcon size={19} />
              <span>Video</span>
            </button>
          </div>
        )}

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
          {(conversation.isGroup ? TABS : [...TABS, POSTS_TAB]).map((t) => (
            <button
              key={t.id}
              className={`ci-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id !== "posts" && (
                <span className="ci-tab-count">{t.id === "media" ? media.length : files.length}</span>
              )}
            </button>
          ))}
        </div>

        {tab === "posts" && other ? (
          <PostsGrid userId={other._id} />
        ) : tab === "media" ? (
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

        {!conversation.isGroup && other && (
          <button className="ci-danger-row" onClick={() => setConfirmBlock(true)}>
            <AlertIcon size={17} />
            <span>Block {other.displayName}</span>
          </button>
        )}
        <p className="ci-e2ee-note">
          <LockIcon size={12} /> This chat is end-to-end encrypted
        </p>
      </div>

      {confirmBlock && other && (
        <ConfirmModal
          title={`Block ${other.displayName}?`}
          message="They won't be able to message you or see your Status. You can unblock them anytime from Settings → Privacy."
          confirmLabel="Block"
          danger
          onConfirm={async () => {
            setConfirmBlock(false);
            try {
              await client.post(`/users/block/${other._id}`);
              showToast(`Blocked ${other.displayName}`);
              onClose();
              closeActiveChat();
            } catch {
              showToast("Could not block contact", "danger");
            }
          }}
          onCancel={() => setConfirmBlock(false)}
        />
      )}

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
      {showStatusViewer && contactStatusEntry && (
        <StatusViewer entry={contactStatusEntry} isOwn={false} onClose={() => setShowStatusViewer(false)} />
      )}
    </aside>
  );
}
