// ---------------------------------------------------------------------------
// Chat + call-history backup into WispChat/Backups and WispChat/Databases.
// Your messages live on the server (that's how they reach your other devices);
// this writes a copy you can keep on the phone or copy elsewhere.
// End-to-end encrypted messages are saved as they are on the server: still
// encrypted, readable only with your account.
// ---------------------------------------------------------------------------
import client from "../api/client";
import { native, isNative } from "./wispNative";

const PAGE = 60;
const MAX_PER_CHAT = 5000;

async function fetchCalls() {
  const calls = [];
  let before;
  for (let i = 0; i < 20; i++) {
    const res = await client.get("/messages/calls", { params: { limit: 100, ...(before ? { before } : {}) } });
    const batch = res.data?.calls || res.data?.messages || [];
    if (!batch.length) break;
    calls.push(...batch);
    before = batch[batch.length - 1].createdAt;
    if (batch.length < 100) break;
  }
  return calls;
}

/** Keeps Databases/call-log.json fresh so the call history also lives in the WispChat folder. */
export async function syncCallLog() {
  if (!isNative) return;
  try {
    const calls = await fetchCalls();
    await native.writeText("Databases", "call-log.json", JSON.stringify({ savedAt: new Date().toISOString(), calls }));
  } catch {
    /* offline — try again next time */
  }
}

export async function backupChats(onProgress) {
  if (!isNative) throw new Error("Backups are only available in the Android app");
  const convRes = await client.get("/conversations");
  const conversations = convRes.data?.conversations || convRes.data || [];
  const out = { app: "WispChat", version: 1, exportedAt: new Date().toISOString(), conversations: [], calls: [] };

  for (let i = 0; i < conversations.length; i++) {
    const conv = conversations[i];
    onProgress?.({ step: "chats", done: i, total: conversations.length });
    const messages = [];
    let before;
    while (messages.length < MAX_PER_CHAT) {
      const res = await client.get(`/messages/${conv._id}`, { params: { limit: PAGE, ...(before ? { before } : {}) } });
      const batch = res.data?.messages || [];
      if (!batch.length) break;
      messages.unshift(...batch);
      before = batch[0].createdAt;
      if (batch.length < PAGE) break;
    }
    out.conversations.push({ conversation: conv, messages });
  }
  onProgress?.({ step: "calls" });
  out.calls = await fetchCalls().catch(() => []);

  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  const name = `WispChat-backup-${stamp}.json`;
  await native.writeText("Backups", name, JSON.stringify(out));
  await native.writeText("Databases", "call-log.json", JSON.stringify({ savedAt: out.exportedAt, calls: out.calls }));
  return { name, chats: out.conversations.length, messages: out.conversations.reduce((n, c) => n + c.messages.length, 0), calls: out.calls.length };
}
