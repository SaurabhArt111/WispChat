import { ArchiveIcon, LayersIcon, MegaphoneIcon, SettingsIcon, UsersIcon } from "../common/Icons";
import BottomSheet from "../common/Sheet/BottomSheet";
import TopSheet from "../common/Sheet/TopSheet";
import "../../styles/bottomNav.css";

const MORE_ITEMS = [
  { id: "groups", label: "Groups", icon: UsersIcon },
  { id: "archived", label: "Archived", icon: ArchiveIcon },
  { id: "media", label: "Media & Storage", icon: LayersIcon },
  { id: "broadcast", label: "Broadcast Lists", icon: MegaphoneIcon },
];

/**
 * The "More" menu. Drag it away (or tap outside / Back / Esc) to dismiss.
 * `from="top"` drops it down from the top edge — handy when it is opened from
 * the MobileMoreButton in a panel header; the default rises from the bottom.
 */
export default function MoreMenuSheet({ open, onClose, onChangeView, onOpenSettings, from = "bottom" }) {
  const Sheet = from === "top" ? TopSheet : BottomSheet;
  return (
    <Sheet open={open} fit title="More" onClose={onClose}>
      {({ close }) => (
        <div className="more-sheet-list">
          {MORE_ITEMS.map((m) => (
            <button
              key={m.id}
              className="bottom-nav-more-item"
              onClick={() => {
                onChangeView(m.id);
                close();
              }}
            >
              <m.icon size={19} />
              <span>{m.label}</span>
            </button>
          ))}
          <button
            className="bottom-nav-more-item"
            onClick={() => {
              close();
              onOpenSettings();
            }}
          >
            <SettingsIcon size={19} />
            <span>Settings</span>
          </button>
        </div>
      )}
    </Sheet>
  );
}
