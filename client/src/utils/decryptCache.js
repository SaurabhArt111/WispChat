// Session-only cache of already-decrypted message results.
//
// The chat list is virtualized, so bubbles are constantly unmounted and
// remounted as you scroll. Without this, every remount re-ran the ECDH
// derive + AES-GCM decrypt for that message (twice for media: once for the
// caption, once for the file), and rendered a "locked" placeholder first —
// which then changed height when the real text arrived. That was the main
// source of scroll jank. With it, a remount reads the result synchronously
// on first render, so the row is the right size immediately.
//
// Only successful decrypts are stored, and the whole thing is dropped when
// the key is locked / the person logs out, so nothing outlives the session.
const results = new Map();

export function decryptCacheKey(message) {
  if (!message?._id) return null;
  return `${message._id}:${message.iv || ""}:${(message.text || "").length}`;
}

export function peekDecrypted(message) {
  const key = decryptCacheKey(message);
  return key ? results.get(key) || null : null;
}

export function storeDecrypted(message, value) {
  const key = decryptCacheKey(message);
  if (key) results.set(key, value);
}

export function clearDecryptCache() {
  results.clear();
}
