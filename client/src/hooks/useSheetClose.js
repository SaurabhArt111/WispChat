import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Close-with-animation for full-screen sheets/pages. On phones the sheet
 * slides back down (220ms) before `onClose` unmounts it; elsewhere it closes
 * immediately. Pair with the `.closing` class rules in styles/newChat.css.
 */
export default function useSheetClose(onClose) {
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const requestClose = useCallback(() => {
    if (closing) return;
    if (window.matchMedia?.("(max-width: 768px)").matches) {
      setClosing(true);
      timer.current = setTimeout(onClose, 220);
    } else {
      onClose();
    }
  }, [closing, onClose]);
  return { closing, requestClose };
}
