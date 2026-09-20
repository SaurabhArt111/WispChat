import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./Icons";

export default function Modal({ title, onClose, children, footer, width }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Rendered into document.body via a portal rather than in place: if any
  // ancestor in the component tree has a CSS transform/filter/contain
  // (several of ours do, for animations), it becomes the containing block
  // for position:fixed children per the CSS spec — which silently breaks
  // "centered on the viewport" and centers the modal on that ancestor's
  // box instead. A portal sidesteps that entirely.
  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={width ? { width } : undefined}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn btn-sm" onClick={onClose} title="Close (Esc)">
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
