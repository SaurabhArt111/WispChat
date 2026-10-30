// ---------------------------------------------------------------------------
// Tracks open sheets so that Escape and the Android / browser Back button
// dismiss only the TOPMOST one.
//
// Back button: a modal sheet pushes one history entry when it opens. Back
// (popstate) then closes the sheet instead of leaving the page; closing the
// sheet any other way pops that entry again so history stays clean.
// React Router never sees our entries (it keys off its own `state.idx`), so
// routing and deep links are untouched.
// ---------------------------------------------------------------------------

const stack = []; // [{ id, requestClose, back, pushed }]
let listening = false;
// popstates WE caused with history.back() (after a sheet closed by other means).
// Each is a token so a lost event (history.back() at the very start of the
// session is a no-op) can't swallow a real Back press later.
let pendingIgnores = [];
let counter = 0;
const IGNORE_TTL = 1500;

export function nextSheetId() {
  counter += 1;
  return `wsheet-${counter}`;
}

function onPopState() {
  if (pendingIgnores.length) {
    clearTimeout(pendingIgnores.shift().timer);
    releaseListeners();
    return;
  }
  // The newest sheet that asked for back-dismissal takes the event.
  for (let i = stack.length - 1; i >= 0; i--) {
    const e = stack[i];
    if (!e.back) continue;
    e.pushed = false; // this entry has just been consumed by the browser
    e.requestClose("back");
    return;
  }
}

function onKeyDown(e) {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  if (top.requestClose("escape") !== false) {
    // Handled: don't let the page-level Esc handlers (Modal, chat, …) also fire.
    e.stopImmediatePropagation();
    e.preventDefault();
  }
}

function ensureListeners() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", onPopState);
  window.addEventListener("keydown", onKeyDown, true); // capture: run before bubble-phase Esc handlers
}

function releaseListeners() {
  // keep listening while one of our own popstates is still on its way
  if (!listening || stack.length || pendingIgnores.length) return;
  listening = false;
  window.removeEventListener("popstate", onPopState);
  window.removeEventListener("keydown", onKeyDown, true);
}

/**
 * Register an open sheet. `requestClose(reason)` should return false when the
 * sheet refuses to close (e.g. not dismissible). Returns an unregister fn.
 */
export function registerSheet({ id, back = true, requestClose }) {
  const entry = { id, requestClose, back, pushed: false };
  stack.push(entry);
  ensureListeners();
  if (back) {
    try {
      window.history.pushState({ __wispSheet: id }, "");
      entry.pushed = true;
    } catch {
      /* sandboxed iframe etc. — Esc still works */
    }
  }
  return function unregister() {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    // Closed by something other than Back → remove the entry we added, but only
    // if it is still the current one (if the app navigated meanwhile, leave it).
    if (entry.pushed && window.history.state?.__wispSheet === id) {
      const token = {
        timer: setTimeout(() => {
          pendingIgnores = pendingIgnores.filter((t) => t !== token);
          releaseListeners();
        }, IGNORE_TTL),
      };
      pendingIgnores.push(token);
      window.history.back();
    }
    entry.pushed = false;
    releaseListeners();
  };
}

/** Test helper. */
export function _resetSheetStack() {
  stack.length = 0;
  pendingIgnores.forEach((t) => clearTimeout(t.timer));
  pendingIgnores = [];
  releaseListeners();
}
