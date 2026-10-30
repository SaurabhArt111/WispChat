import { useEffect } from "react";
import { createPortal } from "react-dom";
import BottomSheet from "./Sheet/BottomSheet";
import useMediaQuery from "../../hooks/useMediaQuery";

/**
 * A short vertical list of mutually-exclusive actions plus Cancel — used
 * for "Delete for me / Delete for everyone", and any future multi-way
 * destructive choice. Distinct from ConfirmModal (which is strictly
 * yes/no) because these have more than one non-cancel outcome.
 */
export default function ActionSheetModal({ title, message, actions, onCancel, cancelLabel = "Cancel" }) {
  const isPhone = useMediaQuery("(max-width: 858px)");

  useEffect(() => {
    if (isPhone) return undefined; // the bottom sheet handles Esc / Back itself
    function onKey(e) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, isPhone]);

  // Phones: a draggable Android-style bottom sheet (swipe down / Back / tap outside = cancel).
  if (isPhone) {
    return (
      <BottomSheet title={title || "Choose an action"} fit zIndex={1300} onClose={onCancel}>
        {({ close }) => (
          <div className="action-sheet-card" role="group">
            {title && <div className="confirm-title">{title}</div>}
            {message && <div className="confirm-message">{message}</div>}
            <div className="action-sheet-list">
              {actions.map((a, i) => (
                <button key={i} className={`action-sheet-item ${a.danger ? "danger" : ""}`} onClick={a.onClick}>
                  {a.icon && <span className="action-sheet-icon">{a.icon}</span>}
                  {a.label}
                </button>
              ))}
            </div>
            <button className="action-sheet-cancel" onClick={close}>
              {cancelLabel}
            </button>
          </div>
        )}
      </BottomSheet>
    );
  }

  return createPortal(
    <div className="confirm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="action-sheet-card" role="alertdialog" aria-modal="true">
        {title && <div className="confirm-title">{title}</div>}
        {message && <div className="confirm-message">{message}</div>}
        <div className="action-sheet-list">
          {actions.map((a, i) => (
            <button
              key={i}
              className={`action-sheet-item ${a.danger ? "danger" : ""}`}
              onClick={a.onClick}
            >
              {a.icon && <span className="action-sheet-icon">{a.icon}</span>}
              {a.label}
            </button>
          ))}
        </div>
        <button className="action-sheet-cancel" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>,
    document.body
  );
}
