import { useEffect, useRef, useState } from "react";
import { DownloadIcon, CloseIcon, RefreshIcon } from "./Icons";
import "../../styles/pwa.css";

const INSTALL_DISMISS_KEY = "wisp_pwa_install_dismissed_at";
const IOS_TIP_DISMISS_KEY = "wisp_pwa_ios_tip_dismissed";
const DISMISS_SNOOZE_MS = 1000 * 60 * 60 * 24 * 7; // re-offer after a week

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/**
 * Mounts once near the app root. Handles three independent, purely-additive
 * concerns so none of them can affect existing app behavior:
 *  1. Registers the service worker (built by vite-plugin-pwa) and shows a
 *     small "Update available" banner, driven entirely by us so the user
 *     controls exactly when the new version activates.
 *  2. Listens for the browser's `beforeinstallprompt` event (Chrome/Edge/
 *     Android) and shows a custom "Install Wisp" banner instead of relying
 *     on the browser's own mini-infobar.
 *  3. On iOS Safari, where no install prompt event exists, shows a one-time
 *     "Add to Home Screen" instruction tip.
 */
export default function PwaManager() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [installEvent, setInstallEvent] = useState(null);
  const [showIosTip, setShowIosTip] = useState(false);
  const updateSWRef = useRef(null);
  const cleanupRef = useRef(null);
  const [updating, setUpdating] = useState(false);

  // --- Service worker registration + update detection ---
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Remove service workers created by older development builds. They can
    // intercept /manifest.webmanifest and return the SPA HTML fallback.
    if (import.meta.env.DEV) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
      return;
    }

    let cancelled = false;

    import("virtual:pwa-register")
      .then(({ registerSW }) => {
        if (cancelled) return;
        updateSWRef.current = registerSW({
          immediate: true,
          onNeedRefresh() {
            setNeedRefresh(true);
          },
          // An installed PWA can stay open for days without a navigation, and
          // browsers only re-check for a new service worker on navigation —
          // so poll, and also check whenever the app returns to the
          // foreground. Either finding a new build triggers onNeedRefresh.
          onRegisteredSW(_url, registration) {
            if (!registration) return;
            const check = () => {
              if (navigator.onLine) registration.update().catch(() => {});
            };
            const timer = setInterval(check, 10 * 60 * 1000);
            const onVisible = () => document.visibilityState === "visible" && check();
            document.addEventListener("visibilitychange", onVisible);
            window.addEventListener("online", check);
            cleanupRef.current = () => {
              clearInterval(timer);
              document.removeEventListener("visibilitychange", onVisible);
              window.removeEventListener("online", check);
            };
          },
          onRegisterError(err) {
            console.warn("[pwa] service worker registration failed", err);
          },
        });
      })
      .catch(() => {
        // Dev server without the PWA virtual module, or SW unsupported —
        // the app works identically without it, just without offline caching.
      });

    return () => {
      cancelled = true;
      cleanupRef.current?.();
    };
  }, []);

  // --- Install prompt (Android/desktop Chrome/Edge) ---
  useEffect(() => {
    if (isStandalone()) return;

    function onBeforeInstallPrompt(e) {
      e.preventDefault();
      const dismissedAt = Number(localStorage.getItem(INSTALL_DISMISS_KEY) || 0);
      if (Date.now() - dismissedAt < DISMISS_SNOOZE_MS) return;
      setInstallEvent(e);
    }
    function onAppInstalled() {
      setInstallEvent(null);
      localStorage.removeItem(INSTALL_DISMISS_KEY);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  // --- iOS "Add to Home Screen" tip (no beforeinstallprompt on iOS Safari) ---
  useEffect(() => {
    if (isStandalone() || !isIos()) return;
    if (localStorage.getItem(IOS_TIP_DISMISS_KEY)) return;
    const t = setTimeout(() => setShowIosTip(true), 4000);
    return () => clearTimeout(t);
  }, []);

  async function handleInstallClick() {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    setInstallEvent(null);
  }

  function dismissInstall() {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    setInstallEvent(null);
  }

  function dismissIosTip() {
    localStorage.setItem(IOS_TIP_DISMISS_KEY, "1");
    setShowIosTip(false);
  }

  function handleReload() {
    setUpdating(true);
    // Activates the waiting service worker and reloads the page once it takes
    // over. If that hand-off ever stalls, fall back to a plain reload so the
    // button can never appear to do nothing.
    updateSWRef.current?.(true);
    setTimeout(() => window.location.reload(), 4000);
  }

  return (
    <>
      {needRefresh && (
        <div className="pwa-update-card" role="alertdialog" aria-live="polite" aria-label="Update available">
          <div className="pwa-update-icon">
            <RefreshIcon size={20} />
          </div>
          <div className="pwa-update-text">
            <strong>Update available</strong>
            <span>A new version of Wisp is ready. Update now to get the latest features and fixes.</span>
          </div>
          <div className="pwa-update-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setNeedRefresh(false)} disabled={updating}>
              Later
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleReload} disabled={updating}>
              {updating ? "Updating…" : "Update now"}
            </button>
          </div>
        </div>
      )}

      {installEvent && (
        <div className="pwa-banner pwa-banner-install" role="status">
          <DownloadIcon size={16} />
          <span>Install Wisp for a faster, full-screen app experience.</span>
          <button className="btn btn-primary btn-sm" onClick={handleInstallClick}>
            Install
          </button>
          <button className="icon-btn btn-sm" onClick={dismissInstall} title="Dismiss">
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      {showIosTip && (
        <div className="pwa-banner pwa-banner-ios" role="status">
          <DownloadIcon size={16} />
          <span>
            Install Wisp: tap <strong>Share</strong> then <strong>Add to Home Screen</strong>.
          </span>
          <button className="icon-btn btn-sm" onClick={dismissIosTip} title="Dismiss">
            <CloseIcon size={14} />
          </button>
        </div>
      )}
    </>
  );
}
