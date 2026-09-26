import { ChatIcon, PhoneIcon, StatusRingIcon, CompassIcon } from "../common/Icons";
import "../../styles/bottomNav.css";

const TABS = [
  { id: "chats", label: "Chats", icon: ChatIcon },
  { id: "status", label: "Status", icon: StatusRingIcon },
  { id: "explore", label: "Explore", icon: CompassIcon },
  { id: "calls", label: "Calls", icon: PhoneIcon },
];

// The "More" tab used to live here (Archived/Media/Broadcast/Settings behind
// a bottom sheet with a bouncy slide-up animation). Both the bounce and the
// tab itself are gone: More is now reached from a small button in the top
// of each panel instead (see MobileMoreButton + MoreMenuSheet). "explore"
// isn't a routed panel — tapping it just opens the find-people flow.
export default function MobileBottomNav({ view, onChangeView, onOpenExplore, hasUnreadStatus }) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`bottom-nav-btn ${view === t.id ? "active" : ""}`}
          onClick={() => (t.id === "explore" ? onOpenExplore?.() : onChangeView(t.id))}
        >
          <span className="bottom-nav-icon">
            <t.icon size={21} />
            {t.id === "status" && hasUnreadStatus && <span className="bottom-nav-dot" />}
          </span>
          <span className="bottom-nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
