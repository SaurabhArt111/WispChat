// A thin, defensive localStorage cache for the two things that otherwise
// make the app look "blank until you reload": the conversation list, and
// each conversation's most recent messages. Both are already
// end-to-end-encrypted ciphertext by the time they reach this layer (see
// ChatContext/e2ee), so caching them here doesn't expose anything that
// wasn't already sitting in memory. Every call is wrapped — localStorage
// can throw (quota, private-browsing, disabled storage) and none of this
// should ever be able to break the app if it does.

const CONVERSATIONS_KEY = "wisp_cache_conversations_v1";
const MESSAGES_KEY_PREFIX = "wisp_cache_messages_v1_";
const MAX_CACHED_MESSAGES_PER_CHAT = 30;
const MAX_CACHED_CONVERSATIONS = 60;

export function readCachedConversations(userId) {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY + ":" + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCachedConversations(userId, conversations) {
  try {
    const trimmed = conversations.slice(0, MAX_CACHED_CONVERSATIONS);
    localStorage.setItem(CONVERSATIONS_KEY + ":" + userId, JSON.stringify(trimmed));
  } catch {
    // Storage full or unavailable — the app still works, it just won't
    // have a warm cache next boot.
  }
}

export function readCachedMessages(userId, conversationId) {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY_PREFIX + userId + ":" + conversationId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCachedMessages(userId, conversationId, messages) {
  try {
    const trimmed = messages.slice(-MAX_CACHED_MESSAGES_PER_CHAT);
    localStorage.setItem(MESSAGES_KEY_PREFIX + userId + ":" + conversationId, JSON.stringify(trimmed));
  } catch {
    // Same as above — non-fatal.
  }
}

export function clearCache(userId) {
  try {
    const prefix = MESSAGES_KEY_PREFIX + userId + ":";
    Object.keys(localStorage)
      .filter((k) => k.startsWith(prefix) || k === CONVERSATIONS_KEY + ":" + userId)
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // Nothing to clean up if storage isn't available in the first place.
  }
}
