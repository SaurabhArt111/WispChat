import { useContextMenu } from "../../context/ContextMenuContext";
import { MoreIcon } from "../common/Icons";

// Every page owns its own "⋮" menu (instead of one shared "More" sheet that
// listed the same destinations everywhere). Pass the items that make sense on
// that page: [{ label, icon, onClick, danger }, { divider: true }, ...].
// Rendered through the shared context menu, so it's a dropdown on desktop and
// a bottom sheet on phones.
export default function PanelMenuButton({ items, title = "Menu" }) {
  const { openMenu } = useContextMenu();
  const visible = (items || []).filter(Boolean);
  if (!visible.length) return null;

  function open(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    openMenu(
      {
        clientX: rect.right,
        clientY: rect.bottom + 6,
        preventDefault() {},
        stopPropagation() {},
      },
      visible,
      title
    );
  }

  return (
    <button className="icon-btn panel-menu-btn" title={title} aria-label={title} onClick={open}>
      <MoreIcon size={18} />
    </button>
  );
}
