import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import client from "../../api/client";
import Avatar from "../common/Avatar";
import ConfirmModal from "../common/ConfirmModal";
import WallpaperPicker from "../common/WallpaperPicker";
import { getGlobalWallpaper, setGlobalWallpaper } from "../../utils/wallpaper";
import {
  CloseIcon,
  SettingsIcon,
  ShieldIcon,
  LockIcon,
  ChatIcon,
  PhoneIcon,
  BellIcon,
  HelpIcon,
  SparklesIcon,
  LogOutIcon,
} from "../common/Icons";
import "../../styles/settingsModal.css";

const ACCENTS = [
  { id: "default", name: "Mint Emerald", color: "#5ef2c0" },
  { id: "cyan", name: "Electric Cyan", color: "#38bdf8" },
  { id: "violet", name: "Cyber Violet", color: "#a78bfa" },
  { id: "ember", name: "Sunset Ember", color: "#f5a65b" },
];

const SHORTCUTS = [
  { keys: "Ctrl / Cmd + F", desc: "Find a conversation" },
  { keys: "/", desc: "Focus search (when nothing else is focused)" },
  { keys: "Ctrl / Cmd + V", desc: "Paste a copied image or file into the chat" },
  { keys: "Ctrl / Cmd + Enter", desc: "Send (when \"Press Enter to Send\" is off)" },
  { keys: "Enter", desc: "Send (when \"Press Enter to Send\" is on)" },
  { keys: "Shift + Enter", desc: "New line in the message box" },
  { keys: "Esc", desc: "Close the open modal, composer, lightbox, or status viewer" },
  { keys: "Scroll", desc: "Zoom in/out in the photo viewer" },
];

const CATEGORIES = [
  { id: "general", label: "General", desc: "App info", icon: SettingsIcon },
  { id: "account", label: "Account", desc: "Security notifications, account info", icon: ShieldIcon },
  { id: "privacy", label: "Privacy", desc: "Blocked contacts, disappearing messages", icon: LockIcon },
  { id: "chats", label: "Chats", desc: "Theme, wallpaper, chat settings", icon: ChatIcon },
  { id: "calls", label: "Video & voice", desc: "Camera, microphone & speakers", icon: PhoneIcon },
  { id: "notifications", label: "Notifications", desc: "Messages, groups, sounds", icon: BellIcon },
  { id: "shortcuts", label: "Keyboard shortcuts", desc: "Quick actions", icon: SparklesIcon },
  { id: "help", label: "Help and feedback", desc: "Help centre, contact us, privacy policy", icon: HelpIcon },
];

export default function SettingsModal({ onClose, onOpenProfile }) {
  const { user, logout } = useAuth();
  const [active, setActive] = useState(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        if (active) setActive(null);
        else onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);

  async function handleLogout() {
    setShowLogoutConfirm(false);
    await logout();
  }

  const activeCategory = CATEGORIES.find((c) => c.id === active);

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-modal">
        <div className="modal-header">
          <h2>{activeCategory ? activeCategory.label : "Settings"}</h2>
          <button className="icon-btn btn-sm" onClick={onClose} title="Close (Esc)">
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="settings-modal-body">
          <div className={`settings-list ${active ? "hide-on-mobile" : ""}`}>
            <button className="settings-profile-row" onClick={onOpenProfile}>
              <Avatar user={user} size={44} />
              <div>
                <div className="settings-profile-name">{user.displayName}</div>
                <div className="settings-profile-sub">@{user.username} · Edit profile</div>
              </div>
            </button>

            {CATEGORIES.map((c) => (
              <button key={c.id} className="settings-list-item" onClick={() => setActive(c.id)}>
                <span className="settings-list-icon">
                  <c.icon size={18} />
                </span>
                <span className="settings-list-text">
                  <span className="settings-list-label">{c.label}</span>
                  <span className="settings-list-desc">{c.desc}</span>
                </span>
              </button>
            ))}

            <button className="settings-list-item danger" onClick={() => setShowLogoutConfirm(true)}>
              <span className="settings-list-icon">
                <LogOutIcon size={18} />
              </span>
              <span className="settings-list-text">
                <span className="settings-list-label">Log out</span>
              </span>
            </button>
          </div>

          <div className={`settings-panel ${!active ? "hide-on-mobile" : ""}`}>
            {active === "general" && <GeneralPanel />}
            {active === "account" && <AccountPanel user={user} onOpenProfile={onOpenProfile} />}
            {active === "privacy" && <PrivacyPanel />}
            {active === "chats" && <ChatsPanel />}
            {active === "calls" && <CallsSettingsPanel />}
            {active === "notifications" && <NotificationsPanel />}
            {active === "shortcuts" && <ShortcutsPanel />}
            {active === "help" && <HelpPanel />}
            {!active && <div className="settings-panel-placeholder">Choose a category</div>}
          </div>
        </div>
      </div>

      {showLogoutConfirm && (
        <ConfirmModal
          title="Log out of Wisp?"
          message="You'll need to sign back in to see your messages again on this device."
          confirmLabel="Log out"
          danger
          onConfirm={handleLogout}
          onCancel={() => setShowLogoutConfirm(false)}
        />
      )}
    </div>,
    document.body
  );
}

function GeneralPanel() {
  return (
    <div className="settings-section">
      <div className="settings-app-badge">
        <div className="settings-app-badge-mark">W</div>
        <div>
          <div className="settings-app-badge-name">Wisp Chat</div>
          <div className="settings-app-badge-version">Version 1.0.0 · Installable PWA</div>
        </div>
      </div>
      <p className="settings-hint">
        Fast, real-time messaging with instant file sharing, pre-send editing tools, Status
        updates, and rich reactions — installable on desktop, Android and iOS.
      </p>
    </div>
  );
}

function AccountPanel({ user, onOpenProfile }) {
  return (
    <div className="settings-section">
      <div className="settings-kv">
        <span>Display name</span>
        <strong>{user.displayName}</strong>
      </div>
      <div className="settings-kv">
        <span>Username</span>
        <strong>@{user.username}</strong>
      </div>
      <p className="settings-hint">
        Security notifications and two-factor login aren't available yet. For now, account
        access is protected by your password alone — use a strong, unique one.
      </p>
      <button className="btn btn-ghost btn-sm" onClick={onOpenProfile}>
        Edit profile
      </button>
    </div>
  );
}

function PrivacyPanel() {
  const { showToast } = useToast();
  const [blocked, setBlocked] = useState(null);
  const [confirmUnblock, setConfirmUnblock] = useState(null);

  useEffect(() => {
    client
      .get("/users/blocked")
      .then((res) => setBlocked(res.data.blocked))
      .catch(() => setBlocked([]));
  }, []);

  async function unblock(u) {
    try {
      await client.post(`/users/block/${u._id}`);
      setBlocked((b) => b.filter((x) => x._id !== u._id));
      showToast(`Unblocked ${u.displayName}`);
    } catch {
      showToast("Couldn't unblock — try again", "danger");
    } finally {
      setConfirmUnblock(null);
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Blocked contacts</div>
      {blocked === null ? (
        <p className="settings-hint">Loading…</p>
      ) : blocked.length === 0 ? (
        <p className="settings-hint">
          You haven't blocked anyone. Blocked contacts can't message you or see your Status.
        </p>
      ) : (
        <div className="settings-blocked-list">
          {blocked.map((u) => (
            <div className="settings-blocked-row" key={u._id}>
              <Avatar user={u} size={36} />
              <div className="settings-blocked-name">{u.displayName}</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmUnblock(u)}>
                Unblock
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="settings-section-title" style={{ marginTop: 20 }}>
        Disappearing messages
      </div>
      <p className="settings-hint">Not available yet — it's on the roadmap.</p>

      {confirmUnblock && (
        <ConfirmModal
          title={`Unblock ${confirmUnblock.displayName}?`}
          message="They'll be able to message you and see your Status again."
          confirmLabel="Unblock"
          onConfirm={() => unblock(confirmUnblock)}
          onCancel={() => setConfirmUnblock(null)}
        />
      )}
    </div>
  );
}

function ChatsPanel() {
  const [currentAccent, setCurrentAccent] = useState(() => localStorage.getItem("wisp_accent") || "default");
  const [currentWallpaper, setCurrentWallpaper] = useState(() => getGlobalWallpaper());
  const [enterToSend, setEnterToSend] = useState(() => {
    const saved = localStorage.getItem("wisp_enter_send");
    return saved !== null ? saved === "true" : true;
  });

  function handleSetWallpaper(value) {
    setCurrentWallpaper(value || "none");
    setGlobalWallpaper(value || "none");
  }

  function handleSetAccent(id) {
    setCurrentAccent(id);
    localStorage.setItem("wisp_accent", id);
    if (id === "default") document.documentElement.removeAttribute("data-accent");
    else document.documentElement.setAttribute("data-accent", id);
  }

  function handleToggleEnterSend(e) {
    const checked = e.target.checked;
    setEnterToSend(checked);
    localStorage.setItem("wisp_enter_send", String(checked));
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Chat Preferences</div>
      <label className="preference-toggle-row">
        <input type="checkbox" checked={enterToSend} onChange={handleToggleEnterSend} />
        <div>
          <div className="preference-title">Press Enter to Send</div>
          <div className="preference-desc">
            When checked, Enter sends messages and Shift+Enter adds a new line. Uncheck to use
            Ctrl+Enter to send.
          </div>
        </div>
      </label>

      <div className="settings-section-title" style={{ marginTop: 20 }}>
        App Accent Theme
      </div>
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

      <div className="settings-section-title" style={{ marginTop: 20 }}>
        Wallpaper
      </div>
      <p className="settings-hint">
        Sets the default background for every chat. Any individual chat can still override this
        from its "More" menu.
      </p>
      <WallpaperPicker value={currentWallpaper} onChange={handleSetWallpaper} />
    </div>
  );
}

function NotificationsPanel() {
  const [permission, setPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );

  async function requestPermission() {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Desktop notifications</div>
      {permission === "unsupported" ? (
        <p className="settings-hint">Your browser doesn't support notifications.</p>
      ) : permission === "granted" ? (
        <p className="settings-hint">✅ Enabled — new messages can show a system notification.</p>
      ) : permission === "denied" ? (
        <p className="settings-hint">
          Blocked in your browser's site settings. Re-enable it there to turn notifications back on.
        </p>
      ) : (
        <>
          <p className="settings-hint">Get notified about new messages even when Wisp is in the background.</p>
          <button className="btn btn-primary btn-sm" onClick={requestPermission}>
            Enable notifications
          </button>
        </>
      )}

      <div className="settings-section-title" style={{ marginTop: 20 }}>
        Message & group sounds
      </div>
      <p className="settings-hint">Sound customization isn't available yet.</p>
    </div>
  );
}

function CallsSettingsPanel() {
  const [micPermission, setMicPermission] = useState("unknown");

  useEffect(() => {
    if (!navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: "microphone" })
      .then((status) => setMicPermission(status.state))
      .catch(() => {});
  }, []);

  return (
    <div className="settings-section">
      <div className="settings-section-title">Voice & video calls</div>
      <p className="settings-hint">
        1-to-1 voice and video calling is built in — look for the phone and camera icons at the
        top of any direct chat. Calls connect peer-to-peer over WebRTC with mandatory DTLS-SRTP
        encryption, so media never passes through the server; once connected, tap the lock/safety
        code shown in the call to verify it end-to-end.
      </p>
      <div className="settings-kv">
        <span>Microphone access</span>
        <strong>
          {micPermission === "granted"
            ? "Allowed"
            : micPermission === "denied"
            ? "Blocked — enable in browser settings"
            : "Requested per call"}
        </strong>
      </div>
      <p className="settings-hint" style={{ marginTop: 14 }}>
        Calls use public STUN servers to establish a connection, which works on most home and
        office networks. A small number of strict corporate/symmetric-NAT networks need a TURN
        relay to connect at all — if a call consistently fails to connect between two specific
        networks, that's usually why.
      </p>
      <p className="settings-hint">Group calling isn't available yet — it's on the roadmap.</p>
    </div>
  );
}

function ShortcutsPanel() {
  return (
    <div className="settings-section">
      {SHORTCUTS.map((s) => (
        <div className="settings-shortcut-row" key={s.keys}>
          <span className="settings-shortcut-key">{s.keys}</span>
          <span className="settings-shortcut-desc">{s.desc}</span>
        </div>
      ))}
    </div>
  );
}

function HelpPanel() {
  return (
    <div className="settings-section">
      <p className="settings-hint">
        Wisp Chat is an independent project. There's no dedicated help centre yet — if something
        looks broken, the fastest way to flag it is directly to whoever's hosting this instance
        for you.
      </p>
      <div className="settings-kv">
        <span>Version</span>
        <strong>1.0.0</strong>
      </div>
    </div>
  );
}

function EmptyPanel({ text }) {
  return (
    <div className="settings-section">
      <p className="settings-hint">{text}</p>
    </div>
  );
}
