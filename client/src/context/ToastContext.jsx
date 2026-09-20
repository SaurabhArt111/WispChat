import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckIcon, AlertIcon, InfoIcon } from "../components/common/Icons";
import "../styles/toast.css";

const ToastContext = createContext(null);
let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts((t) => t.filter((toast) => toast.id !== id));
  }, []);

  // showToast(message, type?, { actionLabel, onAction, duration }?)
  // The action button (e.g. "Undo") calls onAction and dismisses the toast
  // immediately; otherwise it auto-dismisses after `duration` ms.
  const showToast = useCallback(
    (message, type = "default", options = {}) => {
      const id = ++idCounter;
      const duration = options.duration ?? 3500;
      setToasts((t) => [...t, { id, message, type, ...options, duration }]);
      timers.current[id] = setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast, dismiss }}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-icon">
              {t.type === "danger" ? (
                <AlertIcon size={15} />
              ) : t.type === "info" ? (
                <InfoIcon size={15} />
              ) : (
                <CheckIcon size={14} />
              )}
            </span>
            <span className="toast-message">{t.message}</span>
            {t.actionLabel && (
              <button
                className="toast-action"
                onClick={() => {
                  t.onAction?.();
                  dismiss(t.id);
                }}
              >
                {t.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
