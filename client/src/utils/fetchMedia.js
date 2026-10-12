// ---------------------------------------------------------------------------
// Resilient media download used for encrypted attachments.
//
// Why this exists:
//  * `fetch()` does NOT reject on a 404. The old code passed the 404 page body
//    straight into AES-GCM decrypt, which always fails — so a file that was
//    simply *missing on the server* was reported as "Couldn't decrypt".
//  * `net::ERR_QUIC_PROTOCOL_ERROR` (HTTP/3 hiccup between Chrome and the
//    host) surfaces as a TypeError from fetch(). It is transient, so we retry
//    with backoff, and on the last attempt we ask for a cache-busted URL so
//    the browser opens a fresh connection instead of reusing the broken one.
//
// The thrown error carries a `code` so the UI can say the right thing:
//   "missing"  – 404/410: the file is gone from the server (never retried)
//   "network"  – offline / QUIC / 5xx after all retries (user can retry)
//   "locked"   – encryption keys not unlocked on this device
//   "decrypt"  – bytes downloaded fine but could not be decrypted
// ---------------------------------------------------------------------------

const missingUrls = new Set(); // session memory: don't re-request known 404s

export class MediaError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export function isKnownMissing(url) {
  return missingUrls.has(url);
}

export function forgetMissing(url) {
  missingUrls.delete(url);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchMediaBuffer(url, { retries = 3, signal } = {}) {
  if (missingUrls.has(url)) throw new MediaError("missing", "File not found on server");

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new MediaError("network", "aborted");
    try {
      let target = url;
      if (attempt === retries && attempt > 0) {
        const u = new URL(url, window.location.href);
        u.searchParams.set("_r", String(Date.now()));
        target = u.toString();
      }
      const res = await fetch(target, { signal, cache: attempt > 0 ? "reload" : "default" });
      if (res.status === 404 || res.status === 410) {
        missingUrls.add(url);
        throw new MediaError("missing", "File not found on server");
      }
      if (!res.ok) throw new MediaError("network", `HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (err) {
      if (err instanceof MediaError && err.code === "missing") throw err;
      lastErr = err;
      if (err?.name === "AbortError") throw new MediaError("network", "aborted");
      if (attempt < retries) await sleep(400 * 2 ** attempt); // 400ms, 800ms, 1.6s
    }
  }
  throw new MediaError("network", lastErr?.message || "network error");
}
