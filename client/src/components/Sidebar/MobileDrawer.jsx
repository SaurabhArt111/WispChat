import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import Avatar from "../common/Avatar";
import {
  ChatIcon,
  PhoneIcon,
  StatusRingIcon,
  UsersIcon,
  ArchiveIcon,
  LayersIcon,
  MegaphoneIcon,
  SettingsIcon,
  CompassIcon,
} from "../common/Icons";
import "../../styles/mobileDrawer.css";

const MAIN = [
  { id: "chats", label: "Chats", icon: ChatIcon },
  { id: "status", label: "Status", icon: StatusRingIcon },
  { id: "explore", label: "Explore", icon: CompassIcon },
  { id: "calls", label: "Calls", icon: PhoneIcon },
  { id: "groups", label: "Groups", icon: UsersIcon },
];
const LIBRARY = [
  { id: "archived", label: "Archived", icon: ArchiveIcon },
  { id: "media", label: "Media & Storage", icon: LayersIcon },
  { id: "broadcast", label: "Broadcast Lists", icon: MegaphoneIcon },
];

// Slide-in navigation drawer for mobile (opened by swiping left from the
// right side of a chat). Closes on: tapping the dimmed area outside it,
// swiping it back to the right, Esc, or choosing an item.
export default function MobileDrawer({ open, onClose, view, onChangeView, onOpenProfile, onOpenSettings }) {
  const { user } = useAuth();
  const [dragX, setDragX] = useState(0);
  const drag = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function go(fn) {
    onClose();
    // let the close animation start before the view changes underneath
    setTimeout(fn, 60);
  }

  function onTouchStart(e) {
    drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, active: false };
  }
  function onTouchMove(e) {
    const d = drag.current;
    if (!d) return;
    const dx = e.touches[0].clientX - d.x;
    const dy = e.touches[0].clientY - d.y;
    if (!d.active && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) d.active = true;
    if (d.active) setDragX(Math.max(0, dx)); // only follow towards the right (closing)
  }
  function onTouchEnd() {
    const d = drag.current;
    drag.current = null;
    if (d?.active && dragX > 70) {
      try { navigator.vibrate?.(8); } catch { /* ignore */ }
      onClose();
    }
    setDragX(0);
  }

  return (
    <div className={`mobile-drawer-root ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="mobile-drawer-backdrop" onClick={onClose} style={{ opacity: open ? Math.max(0, 1 - dragX / 320) : 0 }} />
      <aside
        className="mobile-drawer"
        data-no-swipe
        role="navigation"
        aria-label="Navigation"
        style={{ transform: open ? `translateX(${dragX}px)` : undefined, transition: drag.current?.active ? "none" : undefined }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <button className="mobile-drawer-profile" onClick={() => go(onOpenProfile)}>
          <Avatar user={user} size={52} />
          <span className="mobile-drawer-who">
            <strong>{user?.displayName}</strong>
            <small>@{user?.username}</small>
          </span>
        </button>

        <nav className="mobile-drawer-list">
          {MAIN.map((it) => (
            <DrawerItem key={it.id} item={it} active={view === it.id} onClick={() => go(() => onChangeView(it.id))} />
          ))}
          <div className="mobile-drawer-divider" />
          {LIBRARY.map((it) => (
            <DrawerItem key={it.id} item={it} active={view === it.id} onClick={() => go(() => onChangeView(it.id))} />
          ))}
          <div className="mobile-drawer-divider" />
          <DrawerItem item={{ label: "Settings", icon: SettingsIcon }} onClick={() => go(onOpenSettings)} />
        </nav>
      </aside>
    </div>
  );
}

function DrawerItem({ item, active, onClick }) {
  const Icon = item.icon;
  return (
    <button className={`mobile-drawer-item ${active ? "active" : ""}`} onClick={onClick}>
      <Icon size={22} />
      <span>{item.label}</span>
    </button>
  );
}
