import { ArchiveIcon, LayersIcon, MegaphoneIcon, SettingsIcon, UsersIcon } from "../common/Icons";
import "../../styles/bottomNav.css";

const MORE_ITEMS = [
  { id: "groups", label: "Groups", icon: UsersIcon },
  { id: "archived", label: "Archived", icon: ArchiveIcon },
  { id: "media", label: "Media & Storage", icon: LayersIcon },
  { id: "broadcast", label: "Broadcast Lists", icon: MegaphoneIcon },
];

export default function MoreMenuSheet({ open, onClose, onChangeView, onOpenSettings }) {
  if (!open) return null;
  return (
    <div className="bottom-nav-more-overlay" onClick={onClose}>
      <div className="bottom-nav-more-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="bottom-nav-more-handle" />
        {MORE_ITEMS.map((m) => (
          <button
            key={m.id}
            className="bottom-nav-more-item"
            onClick={() => {
              onChangeView(m.id);
              onClose();
            }}
          >
            <m.icon size={19} />
            <span>{m.label}</span>
          </button>
        ))}
        <button
          className="bottom-nav-more-item"
          onClick={() => {
            onClose();
            onOpenSettings();
          }}
        >
          <SettingsIcon size={19} />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
