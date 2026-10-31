// ---------------------------------------------------------------------------
// Call log — kept ON THE DEVICE first.
//
// Every call entry that reaches the app (from the server list or live over the
// socket) is merged into the on-device database (IndexedDB) and mirrored to
// WispChat/Databases/call-log.json on Android. The Calls tab renders from here
// instantly, works offline, and the server is only used to catch up.
// ---------------------------------------------------------------------------
import client from "../api/client";
import { mergeCallsDb, readCallsDb } from "./localDb";
import { isNative, native } from "../native/wispNative";

export const readLocalCalls = (userId) => readCallsDb(userId);

async function mirrorToFolder(userId, merged) {
  if (!isNative) return;
  native.writeText("Databases", "call-log.json", JSON.stringify({ savedAt: new Date().toISOString(), userId, calls: merged }));
}

/** Merge entries into the local log (and the Android folder). Returns the merged list. */
export async function saveCalls(userId, entries) {
  const merged = await mergeCallsDb(userId, entries);
  mirrorToFolder(userId, merged);
  return merged;
}

/** Add one live call entry (a `message:new` with callInfo). */
export function recordCall(userId, message) {
  if (userId && message?.callInfo) saveCalls(userId, [message]).catch(() => {});
}

/** Catch the local log up with the server (newest page; older ones only when asked). */
export async function syncCallsFromServer(userId, { limit = 100 } = {}) {
  const res = await client.get("/messages/calls", { params: { limit } });
  const merged = await saveCalls(userId, res.data.calls || []);
  return { merged, hasMore: !!res.data.hasMore };
}
