import { useEffect } from "react";
import { createPortal } from "react-dom";
import EmojiPicker, { EmojiStyle, SuggestionMode } from "emoji-picker-react";
import "../../styles/reactions.css";

/**
 * Full emoji list for reacting — opened by the "+" at the end of the quick
 * reaction row. A bottom sheet on phones, a centred card on desktop.
 */
export default function ReactionPickerSheet({ onPick, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="react-sheet-backdrop" onMouseDown={onClose} onTouchStart={(e) => e.stopPropagation()}>
      <div className="react-sheet" role="dialog" aria-label="Pick a reaction" onMouseDown={(e) => e.stopPropagation()}>
        <div className="react-sheet-handle" />
        <EmojiPicker
          theme="dark"
          emojiStyle={EmojiStyle.NATIVE}
          suggestedEmojisMode={SuggestionMode.RECENT}
          searchPlaceHolder="Search emoji"
          autoFocusSearch={false}
          onEmojiClick={(e) => onPick(e.emoji)}
          width="100%"
          height={380}
          lazyLoadEmojis
          skinTonesDisabled
          previewConfig={{ showPreview: false }}
        />
      </div>
    </div>,
    document.body
  );
}
