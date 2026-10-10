// ---------------------------------------------------------------------------
// Draft messages.
//
// Whatever you've typed in a chat but not sent is saved against that chat and
// restored the next time you open it — after navigating away, switching chats,
// closing the tab or even restarting the browser. A draft is only removed when
// it is sent, or when you clear the text yourself.
//
// Stored per signed-in user in localStorage as { [conversationId]: { text, at } }.
// Only plain text drafts are persisted (attachments live in memory) and, since
// the key is namespaced by user id, logging in as someone else never shows
// another account's drafts. They are also dropped on logout (see clearDrafts).
// ---------------------------------------------------------------------------
const PREFIX = "wisp_drafts_";
const MAX_DRAFTS = 200;
const listeners = new Set();

function key(userId) {
  return `${PREFIX}${userId}`;
}

function readAll(userId) {
  if (!userId) return {};
  try {
    return JSON.parse(localStorage.getItem(key(userId)) || "{}") || {};
  } catch {
    return {};
  }
}

function writeAll(userId, drafts) {
  try {
    const entries = Object.entries(drafts);
    if (entries.length > MAX_DRAFTS) {
      entries.sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
      drafts = Object.fromEntries(entries.slice(0, MAX_DRAFTS));
    }
    localStorage.setItem(key(userId), JSON.stringify(drafts));
  } catch {
    /* storage full / disabled — drafts just won't persist */
  }
}

export function getDraft(userId, conversationId) {
  return readAll(userId)[conversationId]?.text || "";
}

export function saveDraft(userId, conversationId, text) {
  if (!userId || !conversationId) return;
  const drafts = readAll(userId);
  if (text && text.trim()) drafts[conversationId] = { text, at: Date.now() };
  else delete drafts[conversationId];
  writeAll(userId, drafts);
  listeners.forEach((fn) => fn(conversationId));
}

export function clearDraft(userId, conversationId) {
  saveDraft(userId, conversationId, "");
}

export function clearDrafts(userId) {
  try {
    localStorage.removeItem(key(userId));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn(null));
}

export function subscribeDrafts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
