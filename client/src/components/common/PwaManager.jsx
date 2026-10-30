import { isNative } from "../../native/wispNative";
import { useEffect, useRef, useState } from "react";
import { DownloadIcon, CloseIcon, RefreshIcon } from "./Icons";
import { applyUpdate, attachUpdater, checkForUpdate, markNeedRefresh, usePwaUpdate } from "../../utils/pwaUpdate";
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
  const { needRefresh: updateReady, applying: updating } = usePwaUpdate();
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const needRefresh = updateReady && !snoozedUntil;
  const [installEvent, setInstallEvent] = useState(null);
  const [showIosTip, setShowIosTip] = useState(false);
  const updateSWRef = useRef(null);
  const cleanupRef = useRef(null);

  // --- Service worker registration + update detection ---
  useEffect(() => {
    if (isNative || !("serviceWorker" in navigator)) return; // the Android app ships its own web bundle

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
        const update = registerSW({
          immediate: true,
          onNeedRefresh() {
            markNeedRefresh();
            // A phone app that was just opened (cold start) with a new version
            // already waiting: switch to it straight away, before anything is
            // typed — nobody has to tap anything to get the latest build.
            if (performance.now() < 6000) applyUpdate();
          },
          onRegisteredSW(_url, registration) {
            if (!registration) return;
            attachUpdater({ update, reg: registration });
            // Installed PWAs can sit in memory for days and browsers only look for a
            // new build on navigation — so also check on a timer, whenever the app
            // comes back to the foreground, regains the network, or is shown from the
            // back/forward cache.
            const check = () => checkForUpdate();
            check();
            const timer = setInterval(check, 5 * 60 * 1000);
            const onVisible = () => document.visibilityState === "visible" && check();
            document.addEventListener("visibilitychange", onVisible);
            window.addEventListener("focus", check);
            window.addEventListener("online", check);
            window.addEventListener("pageshow", check);
            cleanupRef.current = () => {
              clearInterval(timer);
              document.removeEventListener("visibilitychange", onVisible);
              window.removeEventListener("focus", check);
              window.removeEventListener("online", check);
              window.removeEventListener("pageshow", check);
            };
          },
          onRegisterError(err) {
            console.warn("[pwa] service worker registration failed", err);
          },
        });
        attachUpdater({ update });
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

  // "Later" only snoozes the card — it comes back so an old build can't be forgotten.
  useEffect(() => {
    if (!snoozedUntil) return undefined;
    const t = setTimeout(() => setSnoozedUntil(0), Math.max(0, snoozedUntil - Date.now()));
    return () => clearTimeout(t);
  }, [snoozedUntil]);

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
    applyUpdate();
  }

  // The service worker was meant to be updated by hand — keep a reference to the
  // last registration only inside utils/pwaUpdate.js.
  return (
    <>
      {needRefresh && (
        <div className="pwa-update-card" role="alertdialog" aria-live="polite" aria-label="Update available">
          <div className="pwa-update-icon">
            <RefreshIcon size={20} />
          </div>
          <div className="pwa-update-text">
            <strong>Update available</strong>
            <span>A new version of Wisp is ready. It only takes a second — your chats stay as they are.</span>
          </div>
          <div className="pwa-update-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setSnoozedUntil(Date.now() + 20 * 60 * 1000)} disabled={updating}>
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
