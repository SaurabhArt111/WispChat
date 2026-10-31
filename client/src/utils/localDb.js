// ---------------------------------------------------------------------------
// On-device database (IndexedDB) — the "local first" store.
//
//   messages  last MAX_MESSAGES of every chat (as received: E2EE ciphertext
//             stays ciphertext), so a chat opens instantly and offline.
//   calls     the call history, merged from the server and kept on the phone.
//
// localStorage (utils/messageCache.js) stays as the tiny synchronous cache for
// the very first paint; this is the deep store behind it. Every call is
// wrapped: storage can fail (quota, private mode) and must never break the app.
// ---------------------------------------------------------------------------
const DB_NAME = "wisp-local";
const DB_VERSION = 1;
export const MAX_MESSAGES = 300;
export const MAX_CALLS = 1000;

let dbPromise = null;

function open() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("messages")) db.createObjectStore("messages", { keyPath: "key" });
          if (!db.objectStoreNames.contains("calls")) db.createObjectStore("calls", { keyPath: "key" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function getRecord(store, key) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const r = db.transaction(store, "readonly").objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function putRecord(store, value) {
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function deleteByPrefix(store, prefix) {
  const db = await open();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      const os = tx.objectStore(store);
      const req = os.openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if (String(c.key).startsWith(prefix)) c.delete();
        c.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---- messages ---------------------------------------------------------------

export async function readMessagesDb(userId, conversationId) {
  const rec = await getRecord("messages", `${userId}:${conversationId}`);
  return Array.isArray(rec?.messages) ? rec.messages : null;
}

const pendingWrites = new Map(); // key -> timeout
export function writeMessagesDb(userId, conversationId, messages) {
  const key = `${userId}:${conversationId}`;
  clearTimeout(pendingWrites.get(key));
  pendingWrites.set(
    key,
    setTimeout(() => {
      pendingWrites.delete(key);
      // optimistic / failed bubbles are not real messages yet — don't persist them
      const real = messages.filter((m) => !m.pending && !m.failed && !String(m._id).startsWith("optimistic-"));
      if (real.length) putRecord("messages", { key, messages: real.slice(-MAX_MESSAGES), savedAt: Date.now() });
    }, 600)
  );
}

// ---- calls ------------------------------------------------------------------

export async function readCallsDb(userId) {
  const rec = await getRecord("calls", userId);
  return Array.isArray(rec?.calls) ? rec.calls : [];
}

/** Merge by _id, newest first. Returns the merged list. */
export async function mergeCallsDb(userId, incoming) {
  const existing = await readCallsDb(userId);
  const byId = new Map(existing.map((c) => [String(c._id), c]));
  for (const c of incoming || []) if (c?._id) byId.set(String(c._id), { ...byId.get(String(c._id)), ...c });
  const merged = [...byId.values()]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, MAX_CALLS);
  await putRecord("calls", { key: userId, calls: merged, savedAt: Date.now() });
  return merged;
}

export function clearLocalDb(userId) {
  deleteByPrefix("messages", `${userId}:`);
  deleteByPrefix("calls", userId);
}
