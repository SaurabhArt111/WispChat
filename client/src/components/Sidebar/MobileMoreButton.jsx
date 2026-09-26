import { DotsHorizontalIcon } from "../common/Icons";

// Mobile-only "More" entry point, meant to sit in a panel's top header —
// desktop already has Archived/Media/Broadcast/Settings as individual
// buttons in the AsideRail, so this only renders below the 768px
// breakpoint (see .mobile-more-btn in bottomNav.css).
export default function MobileMoreButton({ onClick }) {
  return (
    <button className="icon-btn mobile-more-btn" onClick={onClick} title="More">
      <DotsHorizontalIcon size={18} />
    </button>
  );
}
