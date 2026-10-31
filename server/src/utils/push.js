// ---------------------------------------------------------------------------
// Push notifications (Firebase Cloud Messaging) for the Android app.
//
// Everything is DATA-ONLY on purpose: the app's own FirebaseMessagingService
// builds the notification / full-screen call screen, so it also works when the
// app is closed or swiped from Recents (not when the user "Force stops" it —
// Android blocks all background delivery in that case, for every app).
//
// The server can't read E2EE messages, so a push never contains encrypted
// text: it carries the sender's name and a kind ("Photo", "Voice message"…).
// Plain (non-encrypted) messages include a short preview.
//
// Configure ONE of (see .env.example):
//   FIREBASE_SERVICE_ACCOUNT_FILE=/path/to/serviceAccount.json
//   FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'  (or base64 of it)
// Without credentials push is simply disabled and everything else still works.
// ---------------------------------------------------------------------------
import fs from "fs";
import User from "../models/User.js";

// ---- background connection (no Google services needed) ----------------------
// The Android app can keep a lightweight, presence-less socket open to this
// server (see android/.../WispSocketService.java). Everything we'd send through
// FCM is ALSO emitted to that socket's private room — so notifications and
// ringing work without Firebase, and Firebase (if configured) is just a second
// path to the same phone. The app de-duplicates by message / call id.
let ioRef = null;
export function attachIo(io) {
  ioRef = io;
}
function emitBackground(userId, data) {
  ioRef?.to(`bg:${userId}`).emit("push", clean(data));
}

let messagingPromise = null;

function loadCredentials() {
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  raw = raw.trim();
  if (!raw.startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(raw);
}

function getMessaging() {
  if (!messagingPromise) {
    messagingPromise = (async () => {
      try {
        const creds = loadCredentials();
        if (!creds) {
          console.log("[push] disabled — no Firebase service account configured");
          return null;
        }
        const admin = (await import("firebase-admin")).default;
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(creds) });
        console.log("[push] Firebase Cloud Messaging ready");
        return admin.messaging();
      } catch (err) {
        console.error("[push] couldn't initialise Firebase:", err?.message);
        return null;
      }
    })();
  }
  return messagingPromise;
}

/** Test seam: inject a fake Firebase messaging client. */
export function _setMessaging(m) {
  messagingPromise = Promise.resolve(m);
}

export async function pushEnabled() {
  return !!(await getMessaging());
}

const str = (v) => (v === undefined || v === null ? "" : String(v));

/** FCM data values must all be strings. */
function clean(data) {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, str(v)]));
}

/** Send a data message to every registered device of a user (FCM). Returns the number sent. */
export async function sendToUser(userId, data, { ttlSeconds = 60 * 60 } = {}) {
  const messaging = await getMessaging();
  if (!messaging) return 0;
  const user = await User.findById(userId).select("pushTokens");
  const tokens = [...new Set((user?.pushTokens || []).map((t) => t.token))];
  if (!tokens.length) return 0;

  let res;
  try {
    res = await messaging.sendEachForMulticast({
      tokens,
      data: clean(data),
      android: { priority: "high", ttl: ttlSeconds * 1000 },
    });
  } catch (err) {
    console.error("[push] send failed:", err?.message);
    return 0;
  }

  // Drop tokens Firebase says are dead (app uninstalled / token rotated).
  const dead = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code || "";
    if (!r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) dead.push(tokens[i]);
  });
  if (dead.length) await User.updateOne({ _id: userId }, { $pull: { pushTokens: { token: { $in: dead } } } });
  return res.successCount;
}

// ---- message notifications ------------------------------------------------

const KIND_LABEL = { image: "📷 Photo", video: "🎥 Video", audio: "🎤 Voice message", file: "📄 Document" };

function previewOf(msg) {
  if (msg.callInfo?.kind) return msg.text || "Call";
  const att = msg.attachments?.[0];
  if (att) {
    const label = KIND_LABEL[att.kind] || KIND_LABEL.file;
    return msg.attachments.length > 1 ? `${label} (+${msg.attachments.length - 1})` : label;
  }
  if (msg.encrypted) return "New message"; // the server can't read it
  const t = (msg.text || "").trim();
  return t.length > 140 ? `${t.slice(0, 137)}…` : t || "New message";
}

/**
 * Notify everyone in the conversation except the sender (and anyone who muted
 * it). The app itself suppresses the notification when the chat is on screen.
 */
export async function pushNewMessage(conv, msg) {
  const senderId = String(msg.sender?._id || msg.sender);
  if (msg.callInfo?.kind) return; // calls have their own flow (+ "missed call" is shown as a message)
  const muted = new Set((conv.mutedBy || []).map(String));
  const base = {
    type: "message",
    conversationId: conv._id,
    messageId: msg._id,
    senderId,
    senderName: msg.sender?.displayName || "New message",
    isGroup: !!conv.isGroup,
    groupName: conv.isGroup ? conv.name || "Group" : "",
    preview: previewOf(msg),
    ts: msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now(),
  };
  const blockers = new Set(
    (await User.find({ _id: { $in: conv.participants || [] }, blocked: senderId }).select("_id").lean()).map((u) => String(u._id))
  );
  const recipients = (conv.participants || []).map(String).filter((id) => id !== senderId && !muted.has(id) && !blockers.has(id));
  recipients.forEach((id) => emitBackground(id, base)); // background socket (no Firebase needed)
  if (!(await pushEnabled())) return;
  await Promise.all(recipients.map((id) => sendToUser(id, base).catch(() => 0)));
}

// ---- call notifications ---------------------------------------------------

export function callPayload({ callId, conversationId, kind, from }) {
  return {
    type: "call",
    callId,
    conversationId,
    kind,
    callerId: from?._id,
    callerName: from?.displayName || "Someone",
    ts: Date.now(),
  };
}

export function pushIncomingCall(calleeId, call) {
  const data = callPayload(call);
  emitBackground(calleeId, data);
  return sendToUser(calleeId, data, { ttlSeconds: 45 }); // a ring that arrives late is worse than none
}

/** Ring a freshly (re)connected background socket for a call that is already ringing. */
export function emitCallTo(socket, call) {
  socket.emit("push", clean(callPayload(call)));
}

export function pushCallEnded(calleeId, callId, reason = "ended") {
  emitBackground(calleeId, { type: "call-end", callId, reason });
  return sendToUser(calleeId, { type: "call-end", callId, reason }, { ttlSeconds: 45 });
}
