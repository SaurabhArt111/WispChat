import { PlusIcon } from "../common/Icons";

// Same order as WhatsApp's reaction row.
export const QUICK_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export default function QuickReactions({ emojis, current, onPick, onMore, align = "left", className = "" }) {
  return (
    <div className={`quick-reactions ${align} ${className}`} onClick={(e) => e.stopPropagation()}>
      {emojis.map((e) => (
        <button key={e} className={current === e ? "active" : ""} onClick={() => onPick(e)}>
          {e}
        </button>
      ))}
      {onMore && (
        <button className="quick-reactions-more" onClick={onMore} title="More reactions" aria-label="More reactions">
          <PlusIcon size={18} />
        </button>
      )}
    </div>
  );
}
