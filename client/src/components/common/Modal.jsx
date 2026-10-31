import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./Icons";
import BottomSheet from "./Sheet/BottomSheet";
import useMediaQuery from "../../hooks/useMediaQuery";

export default function Modal({ title, onClose, children, footer, width }) {
  const isPhone = useMediaQuery("(max-width: 858px)");
  // On phones the sheet slides back down before it unmounts (see
  // styles/mobileSheets.css); on desktop it closes immediately.
  const [closing, setClosing] = useState(false);
  const timerRef = useRef(null);
  const requestClose = useCallback(() => {
    if (closing) return;
    if (window.matchMedia?.("(max-width: 858px)").matches) {
      setClosing(true);
      timerRef.current = setTimeout(onClose, 220);
    } else {
      onClose();
    }
  }, [closing, onClose]);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (isPhone) return undefined; // the bottom sheet handles Esc / Back itself
    function onKeyDown(e) {
      if (e.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestClose, isPhone]);

  // Phones: every dialog is a draggable Android-style bottom sheet — drag the
  // grip/header or pull the content down to dismiss, Back closes it, and it
  // rides above the keyboard. (The hooks above still run; they're inert here.)
  if (isPhone) {
    return (
      <BottomSheet
        title={title}
        fit
        onClose={onClose}
        header={({ close }) => (
          <div className="modal-header sheet-modal-header">
            <h2>{title}</h2>
            <button className="icon-btn btn-sm" onClick={close} title="Close">
              <CloseIcon size={18} />
            </button>
          </div>
        )}
        footer={footer ? <div className="modal-footer">{footer}</div> : undefined}
      >
        <div className="modal-body sheet-modal-body">{children}</div>
      </BottomSheet>
    );
  }

  // Rendered into document.body via a portal rather than in place: if any
  // ancestor in the component tree has a CSS transform/filter/contain
  // (several of ours do, for animations), it becomes the containing block
  // for position:fixed children per the CSS spec — which silently breaks
  // "centered on the viewport" and centers the modal on that ancestor's
  // box instead. A portal sidesteps that entirely.
  return createPortal(
    <div
      className={`modal-overlay ${closing ? "closing" : ""}`}
      onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
    >
      <div className="modal" style={width ? { width } : undefined}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn btn-sm" onClick={requestClose} title="Close (Esc)">
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
