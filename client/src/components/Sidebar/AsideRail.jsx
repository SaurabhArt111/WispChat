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
} from "../common/Icons";
import "../../styles/asideRail.css";

const NAV_ITEMS = [
  { id: "chats", label: "Chats", icon: ChatIcon },
  { id: "calls", label: "Calls", icon: PhoneIcon },
  { id: "status", label: "Status", icon: StatusRingIcon },
  { id: "groups", label: "Groups", icon: UsersIcon },
];

const LIBRARY_ITEMS = [
  { id: "archived", label: "Archived", icon: ArchiveIcon },
  { id: "media", label: "Media & Storage", icon: LayersIcon },
  { id: "broadcast", label: "Broadcast Lists", icon: MegaphoneIcon },
];

export default function AsideRail({ view, onChangeView, onOpenProfile, hasUnreadStatus }) {
  const { user } = useAuth();

  return (
    <nav className="aside-rail" aria-label="Primary">
      <div className="aside-rail-group">
        {NAV_ITEMS.map((item) => (
          <RailButton
            key={item.id}
            item={item}
            active={view === item.id}
            onClick={() => onChangeView(item.id)}
            dot={item.id === "status" && hasUnreadStatus}
          />
        ))}
      </div>

      <div className="aside-rail-divider" />

      <div className="aside-rail-group">
        {LIBRARY_ITEMS.map((item) => (
          <RailButton
            key={item.id}
            item={item}
            active={view === item.id}
            onClick={() => onChangeView(item.id)}
          />
        ))}
      </div>

      <div className="aside-rail-spacer" />

      <div className="aside-rail-group">
        <RailButton
          item={{ id: "settings", label: "Settings", icon: SettingsIcon }}
          active={false}
          onClick={onOpenProfile}
        />
        <button className="aside-rail-avatar-btn" onClick={onOpenProfile} title="Profile & Settings">
          <Avatar user={user} size={34} />
        </button>
      </div>
    </nav>
  );
}

function RailButton({ item, active, onClick, dot }) {
  const Icon = item.icon;
  return (
    <button
      className={`aside-rail-btn ${active ? "active" : ""}`}
      onClick={onClick}
      title={item.label}
      aria-label={item.label}
      aria-current={active}
    >
      <Icon size={21} />
      {dot && <span className="aside-rail-dot" />}
    </button>
  );
}
