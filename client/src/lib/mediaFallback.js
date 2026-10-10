// ---------------------------------------------------------------------------
// Global media fallbacks.
//
// Call installMediaFallbacks() once at startup (see main.jsx). It attaches ONE
// capture-phase `error` listener to the document — media `error` events don't
// bubble, but they can be captured — so every <img>, <video>, <audio> and
// <source> in the app (including ones added later, third-party avatars, link
// preview images, GIFs…) gets the same graceful behaviour without each
// component wiring its own onError:
//
//   1. Retry once with a cache-busting param (transient network / 5xx / a
//      stale Service Worker response).
//   2. If it still fails: <img> is swapped for an inline SVG placeholder,
//      <video>/<audio> get a `media-failed` class + data attribute that CSS
//      can style, and the element is marked so we never loop.
//   3. When the browser comes back online, failed images are retried again.
//
// Opt out per element with data-no-fallback (e.g. components like SafeMedia
// that render their own "File unavailable" UI).
// ---------------------------------------------------------------------------

const RETRY_PARAM = "_mf";
const MAX_RETRIES = 1;
const failedImages = new Set(); // WeakRef-free: cleared on online retry

const PLACEHOLDER_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
      <rect width="120" height="120" fill="#1b1f27"/>
      <g fill="none" stroke="#6b7385" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="30" y="34" width="60" height="52" rx="8"/>
        <circle cx="48" cy="52" r="6"/>
        <path d="M32 80l20-18 14 12 10-8 12 10"/>
      </g>
    </svg>`
  );

function isSkippable(src) {
  return !src || src.startsWith("data:") || src.startsWith("blob:") || src === PLACEHOLDER_SVG;
}

function withBust(src) {
  try {
    const url = new URL(src, window.location.href);
    url.searchParams.set(RETRY_PARAM, String(Date.now()));
    return url.toString();
  } catch {
    return src;
  }
}

function stripBust(src) {
  try {
    const url = new URL(src, window.location.href);
    url.searchParams.delete(RETRY_PARAM);
    return url.toString();
  } catch {
    return src;
  }
}

function markFailed(el) {
  el.dataset.mediaFailed = "true";
  el.classList.add("media-failed");
}

function handleError(event) {
  const el = event.target;
  if (!el || !el.tagName) return;
  const tag = el.tagName;
  if (tag !== "IMG" && tag !== "VIDEO" && tag !== "AUDIO" && tag !== "SOURCE") return;

  // <source> failures are reported on the source; the real element is its parent.
  const media = tag === "SOURCE" ? el.parentElement : el;
  if (!media || media.hasAttribute("data-no-fallback") || media.dataset.mediaFailed === "true") return;

  const currentSrc = tag === "SOURCE" ? el.getAttribute("src") : media.currentSrc || media.getAttribute("src");
  if (isSkippable(currentSrc)) {
    if (tag === "IMG" && !currentSrc) return;
    if (tag === "IMG") applyImagePlaceholder(media);
    else markFailed(media);
    return;
  }

  const tries = Number(media.dataset.mediaRetries || 0);
  if (tries < MAX_RETRIES && navigator.onLine !== false) {
    media.dataset.mediaRetries = String(tries + 1);
    const next = withBust(currentSrc);
    if (tag === "SOURCE") {
      el.setAttribute("src", next);
      media.load?.();
    } else {
      media.setAttribute("src", next);
      media.load?.();
    }
    return;
  }

  if (tag === "IMG") applyImagePlaceholder(media);
  else markFailed(media);
}

function applyImagePlaceholder(img) {
  img.dataset.originalSrc = stripBust(img.getAttribute("src") || "");
  img.removeAttribute("srcset");
  img.src = PLACEHOLDER_SVG;
  img.classList.add("media-fallback-img");
  markFailed(img);
  failedImages.add(img);
}

function retryFailedMedia() {
  failedImages.forEach((img) => {
    if (!img.isConnected) {
      failedImages.delete(img);
      return;
    }
    const original = img.dataset.originalSrc;
    if (!original) return;
    img.dataset.mediaRetries = "0";
    delete img.dataset.mediaFailed;
    img.classList.remove("media-failed", "media-fallback-img");
    img.src = withBust(original);
    failedImages.delete(img);
  });
  document.querySelectorAll("video.media-failed, audio.media-failed").forEach((m) => {
    m.dataset.mediaRetries = "0";
    delete m.dataset.mediaFailed;
    m.classList.remove("media-failed");
    m.load?.();
  });
}

let installed = false;

export function installMediaFallbacks() {
  if (installed || typeof document === "undefined") return () => {};
  installed = true;
  // `true` = capture phase, the only way to observe non-bubbling media errors.
  document.addEventListener("error", handleError, true);
  window.addEventListener("online", retryFailedMedia);
  return () => {
    document.removeEventListener("error", handleError, true);
    window.removeEventListener("online", retryFailedMedia);
    installed = false;
  };
}

export { PLACEHOLDER_SVG };
