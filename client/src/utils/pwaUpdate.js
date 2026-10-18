// ---------------------------------------------------------------------------
// One small store for "is there a newer version of the app?", shared by the
// update popup (PwaManager) and Settings → General ("Check for updates").
// ---------------------------------------------------------------------------
import { useSyncExternalStore } from "react";

export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
export const APP_BUILD = typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : "";

let state = { needRefresh: false, checking: false, lastChecked: 0, applying: false, supported: false };
const listeners = new Set();
let registration = null;
let updateSW = null;

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function usePwaUpdate() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state
  );
}

export function attachUpdater({ update, reg }) {
  updateSW = update;
  registration = reg || registration;
  set({ supported: true });
}

export function markNeedRefresh() {
  set({ needRefresh: true, checking: false, lastChecked: Date.now() });
}

/** Ask the browser to look for a new service worker right now. */
export async function checkForUpdate({ force = false } = {}) {
  if (!registration || !navigator.onLine) return false;
  if (!force && Date.now() - state.lastChecked < 30_000) return state.needRefresh;
  set({ checking: true });
  try {
    await registration.update();
    // `waiting` appears once the new worker has finished installing.
    if (registration.waiting) markNeedRefresh();
    else if (registration.installing) {
      await new Promise((resolve) => {
        const sw = registration.installing;
        const done = () => sw.state === "installed" || sw.state === "redundant" ? resolve() : null;
        sw.addEventListener("statechange", done);
        setTimeout(resolve, 15_000);
      });
      if (registration.waiting) markNeedRefresh();
    }
  } catch {
    /* offline / blocked — try again later */
  }
  set({ checking: false, lastChecked: Date.now() });
  return state.needRefresh;
}

/** Activate the waiting version and reload into it. */
export function applyUpdate() {
  set({ applying: true });
  try {
    updateSW?.(true);
  } catch {
    /* fall through to the hard reload below */
  }
  // If the hand-off ever stalls, a plain reload still picks up the new build.
  setTimeout(() => window.location.reload(), 3500);
}
