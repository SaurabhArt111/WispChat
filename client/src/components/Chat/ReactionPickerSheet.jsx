import { useEffect } from "react";
import { createPortal } from "react-dom";
import EmojiPicker, { EmojiStyle, SuggestionMode } from "emoji-picker-react";
import BottomSheet from "../common/Sheet/BottomSheet";
import useMediaQuery from "../../hooks/useMediaQuery";
import "../../styles/reactions.css";

function Picker({ onPick }) {
  return (
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
  );
}

/**
 * Full emoji list for reacting — opened by the "+" at the end of the quick
 * reaction row. A draggable bottom sheet on phones (swipe the grip, or pull
 * the emoji list down from its top, to dismiss; Back closes it), a centred
 * card on desktop.
 */
export default function ReactionPickerSheet({ onPick, onClose }) {
  const isPhone = useMediaQuery("(max-width: 858px)");

  useEffect(() => {
    if (isPhone) return undefined; // the sheet handles Esc / Back itself
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isPhone]);

  if (isPhone) {
    return (
      <BottomSheet title="Pick a reaction" fit zIndex={4000} onClose={onClose}>
        <div className="react-sheet-picker">
          <Picker onPick={onPick} />
        </div>
      </BottomSheet>
    );
  }

  return createPortal(
    <div className="react-sheet-backdrop" onMouseDown={onClose} onTouchStart={(e) => e.stopPropagation()}>
      <div className="react-sheet" role="dialog" aria-label="Pick a reaction" onMouseDown={(e) => e.stopPropagation()}>
        <div className="react-sheet-handle" />
        <Picker onPick={onPick} />
      </div>
    </div>,
    document.body
  );
}
