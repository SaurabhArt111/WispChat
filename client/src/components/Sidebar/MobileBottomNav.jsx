import { useState } from "react";
import { ChatIcon, PhoneIcon, StatusRingIcon, UsersIcon, MoreIcon, ArchiveIcon, LayersIcon, MegaphoneIcon, SettingsIcon } from "../common/Icons";
import "../../styles/bottomNav.css";

const TABS = [
  { id: "chats", label: "Chats", icon: ChatIcon },
  { id: "status", label: "Status", icon: StatusRingIcon },
  { id: "groups", label: "Groups", icon: UsersIcon },
  { id: "calls", label: "Calls", icon: PhoneIcon },
];

const MORE_ITEMS = [
  { id: "archived", label: "Archived", icon: ArchiveIcon },
  { id: "media", label: "Media & Storage", icon: LayersIcon },
  { id: "broadcast", label: "Broadcast Lists", icon: MegaphoneIcon },
];

export default function MobileBottomNav({ view, onChangeView, onOpenSettings, hasUnreadStatus }) {
  const [showMore, setShowMore] = useState(false);
  const moreActive = MORE_ITEMS.some((m) => m.id === view);

  return (
    <>
      <nav className="bottom-nav" aria-label="Primary">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`bottom-nav-btn ${view === t.id ? "active" : ""}`}
            onClick={() => onChangeView(t.id)}
          >
            <span className="bottom-nav-icon">
              <t.icon size={21} />
              {t.id === "status" && hasUnreadStatus && <span className="bottom-nav-dot" />}
            </span>
            <span className="bottom-nav-label">{t.label}</span>
          </button>
        ))}
        <button
          className={`bottom-nav-btn ${moreActive ? "active" : ""}`}
          onClick={() => setShowMore((s) => !s)}
        >
          <span className="bottom-nav-icon">
            <MoreIcon size={21} />
          </span>
          <span className="bottom-nav-label">More</span>
        </button>
      </nav>

      {showMore && (
        <div className="bottom-nav-more-overlay" onClick={() => setShowMore(false)}>
          <div className="bottom-nav-more-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="bottom-nav-more-handle" />
            {MORE_ITEMS.map((m) => (
              <button
                key={m.id}
                className="bottom-nav-more-item"
                onClick={() => {
                  onChangeView(m.id);
                  setShowMore(false);
                }}
              >
                <m.icon size={19} />
                <span>{m.label}</span>
              </button>
            ))}
            <button
              className="bottom-nav-more-item"
              onClick={() => {
                setShowMore(false);
                onOpenSettings();
              }}
            >
              <SettingsIcon size={19} />
              <span>Settings</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
