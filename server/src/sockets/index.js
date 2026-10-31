import { verifyToken } from "../utils/jwt.js";
import User from "../models/User.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import { attachIo, emitCallTo, pushCallEnded, pushEnabled, pushIncomingCall } from "../utils/push.js";

const onlineUsers = new Map(); // userId -> Set(socketIds)
// Presence-less sockets held open by the Android app's background service so it
// can notify / ring with the app closed. They are NOT "online" (no presence,
// no typing, no read state) — they only receive `push` events.
const bgUsers = new Map(); // userId -> Set(socketIds)

// Calls are signaled entirely through sockets (offer/answer/ICE relay) —
// the server never touches audio/video, it only passes SDP/ICE metadata
// between the two participants' `user:<id>` rooms. Because the actual
// media connection is a direct peer-to-peer WebRTC link using mandatory
// DTLS-SRTP, the call itself is end-to-end encrypted without the server
// needing to do anything cryptographic; this map just tracks who's in a
// call with whom so a second incoming call can be told "busy" and so a
// mid-call disconnect can notify the other side.
const activeCalls = new Map(); // callId -> { callerId, calleeId, conversationId, kind, startedAt, status }
const userActiveCall = new Map(); // userId -> callId
const ringTimers = new Map(); // callId -> Timeout (server-side ring-out)
const dropTimers = new Map(); // userId -> Timeout (grace period after a mid-call disconnect)

// A wifi handoff or a mobile network blip drops the socket for a few
// seconds and then reconnects. Ending the call the instant that happens
// made calls feel fragile, so a mid-call drop gets a short grace window to
// come back before the other side is told the call is over.
const CALL_DROP_GRACE_MS = 15000;

function clearCallState(call, callId) {
  activeCalls.delete(callId);
  if (userActiveCall.get(call.callerId) === callId) userActiveCall.delete(call.callerId);
  if (userActiveCall.get(call.calleeId) === callId) userActiveCall.delete(call.calleeId);
  clearTimeout(ringTimers.get(callId));
  ringTimers.delete(callId);
}

// A callee whose app is closed has no socket, so the invite is pushed (FCM) and
// the call stays "ringing" on the server. When the person taps Accept the app
// starts, connects, and `deliverPendingCall` hands it the invite again, plus
// the ICE candidates the caller sent in the meantime.
const MAX_BUFFERED_ICE = 150;

function deliverPendingCall(io, userId) {
  const callId = userActiveCall.get(userId);
  const call = callId && activeCalls.get(callId);
  if (!call || call.calleeId !== userId || call.status !== "ringing" || !call.incoming) return;
  io.to(`user:${userId}`).emit("call:incoming", call.incoming);
  call.pendingIce.forEach((candidate) => io.to(`user:${userId}`).emit("call:ice-candidate", { callId, candidate }));
  call.pendingIce = [];
}

/**
 * Decline / cancel a call by id. Shared by the socket event and the REST
 * endpoint (used by the notification's Decline button while the app is closed).
 */
export async function declineCallById(io, userId, callId) {
  const call = activeCalls.get(callId);
  if (!call) return false;
  if (call.callerId !== userId && call.calleeId !== userId) return false;
  if (call.callerId === userId) {
    io.to(`user:${call.calleeId}`).emit("call:ended", { callId, reason: "cancelled" });
    pushCallEnded(call.calleeId, callId, "cancelled").catch(() => {});
  } else {
    io.to(`user:${call.callerId}`).emit("call:declined", { callId });
    pushCallEnded(call.calleeId, callId, "declined").catch(() => {});
  }
  io.to(`user:${userId}`).emit("call:handled-elsewhere", { callId });
  const status = call.callerId === userId ? "missed" : "declined";
  const wasConnected = !!call.connectedAt;
  const durationSec = wasConnected ? Math.round((Date.now() - call.connectedAt) / 1000) : 0;
  clearCallState(call, callId);
  await logCallMessage(io, {
    conversationId: call.conversationId,
    callerId: call.callerId,
    kind: call.kind,
    status: wasConnected ? "completed" : status,
    durationSec,
  });
  return true;
}

function callSummaryText(kind, status, durationSec) {
  const label = kind === "video" ? "Video call" : "Voice call";
  if (status === "completed") {
    const m = Math.floor(durationSec / 60);
    const s = durationSec % 60;
    return `${label} · ${m > 0 ? `${m}m ` : ""}${s}s`;
  }
  if (status === "missed") return `Missed ${label.toLowerCase()}`;
  if (status === "declined") return `${label} declined`;
  return `${label} ended`;
}

async function logCallMessage(io, { conversationId, callerId, kind, status, durationSec = 0 }) {
  try {
    const msg = await Message.create({
      conversation: conversationId,
      sender: callerId,
      text: callSummaryText(kind, status, durationSec),
      callInfo: { kind, status, durationSec },
      deliveredTo: [callerId],
      readBy: [callerId],
    });
    const populated = await msg.populate("sender", "username displayName avatar avatarColor e2ee.publicKeyJwk");
    const conv = await Conversation.findByIdAndUpdate(
      conversationId,
      { lastMessage: populated._id, lastMessageAt: populated.createdAt },
      { new: true }
    );
    conv?.participants.forEach((uid) => io.to(`user:${uid}`).emit("message:new", populated));
  } catch (err) {
    // A failure to log the call summary message shouldn't affect the
    // call itself — it already happened either way.
    console.error("[calls] couldn't log call summary:", err?.message);
  }
}

export function initSockets(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No token"));
      const payload = verifyToken(token);
      const user = await User.findById(payload.id);
      if (!user) return next(new Error("User not found"));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error("Auth failed"));
    }
  });

  attachIo(io);

  io.on("connection", async (socket) => {
    const userId = String(socket.user._id);

    if (socket.handshake.auth?.background) {
      socket.join(`bg:${userId}`);
      if (!bgUsers.has(userId)) bgUsers.set(userId, new Set());
      bgUsers.get(userId).add(socket.id);
      socket.on("disconnect", () => {
        const set = bgUsers.get(userId);
        set?.delete(socket.id);
        if (set && !set.size) bgUsers.delete(userId);
      });
      // a call that is ringing right now should ring on this phone too
      const ringingId = userActiveCall.get(userId);
      const ringing = ringingId && activeCalls.get(ringingId);
      if (ringing && ringing.calleeId === userId && ringing.status === "ringing" && ringing.incoming) {
        emitCallTo(socket, { callId: ringingId, conversationId: ringing.conversationId, kind: ringing.kind, from: ringing.incoming.from });
      }
      return;
    }

    socket.join(`user:${userId}`);
    socket.join("explore");

    // Back within the grace window — cancel the pending "call dropped".
    if (dropTimers.has(userId)) {
      clearTimeout(dropTimers.get(userId));
      dropTimers.delete(userId);
      const resumeCallId = userActiveCall.get(userId);
      const resumeCall = resumeCallId && activeCalls.get(resumeCallId);
      if (resumeCall) {
        const otherId = resumeCall.callerId === userId ? resumeCall.calleeId : resumeCall.callerId;
        io.to(`user:${otherId}`).emit("call:peer-reconnected", { callId: resumeCallId });
      }
    }

    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    await User.findByIdAndUpdate(userId, { isOnline: true });
    deliverPendingCall(io, userId); // app opened from the "incoming call" notification

    const conversations = await Conversation.find({ participants: userId }).select("_id participants");
    conversations.forEach((c) => socket.join(`conversation:${c._id}`));

    // Notify contacts this user is online
    const contactIds = new Set();
    conversations.forEach((c) => c.participants.forEach((p) => contactIds.add(String(p))));
    contactIds.forEach((cid) => io.to(`user:${cid}`).emit("presence:update", { userId, isOnline: true }));

    socket.on("typing:start", ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit("typing:update", {
        conversationId,
        userId,
        displayName: socket.user.displayName,
        typing: true,
      });
    });

    socket.on("typing:stop", ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit("typing:update", {
        conversationId,
        userId,
        typing: false,
      });
    });

    socket.on("conversation:join", ({ conversationId }) => {
      socket.join(`conversation:${conversationId}`);
    });

    // ---------------- Calls (WebRTC signaling relay) ----------------

    async function finishCall(callId, { by, statusOverride } = {}) {
      const call = activeCalls.get(callId);
      if (!call) return;
      const wasConnected = !!call.connectedAt;
      const durationSec = wasConnected ? Math.round((Date.now() - call.connectedAt) / 1000) : 0;
      clearCallState(call, callId);
      await logCallMessage(io, {
        conversationId: call.conversationId,
        callerId: call.callerId,
        kind: call.kind,
        status: statusOverride || (wasConnected ? "completed" : "missed"),
        durationSec,
      });
      return call;
    }

    // Device info a caller/callee announces ("mobile" | "tablet" | "desktop" and
    // its screen orientation) so the other side can lay the video out for a
    // portrait phone vs a landscape computer. Never trust the client blindly.
    function cleanDevice(d) {
      const types = ["mobile", "tablet", "desktop"];
      const orients = ["portrait", "landscape"];
      return {
        type: types.includes(d?.type) ? d.type : "desktop",
        orientation: orients.includes(d?.orientation) ? d.orientation : "landscape",
      };
    }

    socket.on("call:invite", async ({ callId, calleeId, conversationId, kind, offer, device }) => {
      if (!callId || !calleeId || !conversationId || !offer) return;

      // Already on a call (either side) — auto-busy instead of ringing.
      if (userActiveCall.has(calleeId) || userActiveCall.has(userId)) {
        socket.emit("call:busy", { callId });
        return;
      }
      // Callee has no live connection: if they have the Android app, ring it via
      // push (full-screen call screen). Otherwise nobody can be rung — log a miss.
      const callee = await User.findById(calleeId).select("pushTokens");
      const canPush = !onlineUsers.has(calleeId) && (bgUsers.has(calleeId) || ((callee?.pushTokens?.length || 0) > 0 && (await pushEnabled())));
      if (!onlineUsers.has(calleeId) && !canPush) {
        socket.emit("call:unavailable", { callId });
        await logCallMessage(io, { conversationId, callerId: userId, kind, status: "missed" });
        return;
      }

      const from = { _id: socket.user._id, displayName: socket.user.displayName, avatar: socket.user.avatar, avatarColor: socket.user.avatarColor };
      const incoming = { callId, conversationId, kind, offer, device: cleanDevice(device), from };
      activeCalls.set(callId, {
        callerId: userId,
        calleeId,
        conversationId,
        kind,
        status: "ringing",
        startedAt: Date.now(),
        callerSocketId: socket.id,
        incoming, // kept so it can be re-delivered when a closed app is opened
        pendingIce: [],
      });
      userActiveCall.set(userId, callId);
      userActiveCall.set(calleeId, callId);

      io.to(`user:${calleeId}`).emit("call:incoming", incoming);
      // Also wake the phone: the Android app shows it only if it isn't already on screen.
      pushIncomingCall(calleeId, { callId, conversationId, kind, from }).catch(() => {});
      // Let the caller know the invite actually reached the callee's devices.
      socket.emit("call:ringing", { callId });

      // No answer within 45s — treat as missed, same as a phone ringing out.
      ringTimers.set(
        callId,
        setTimeout(async () => {
          const call = activeCalls.get(callId);
          if (call && call.status === "ringing") {
            io.to(`user:${call.callerId}`).emit("call:timeout", { callId });
            io.to(`user:${call.calleeId}`).emit("call:timeout", { callId });
            pushCallEnded(call.calleeId, callId, "timeout").catch(() => {});
            await finishCall(callId, { statusOverride: "missed" });
          }
        }, 45000)
      );
    });

    socket.on("call:answer", ({ callId, answer, device }) => {
      const call = activeCalls.get(callId);
      if (!call || call.calleeId !== userId || !answer) return;
      call.status = "connected";
      call.connectedAt = Date.now();
      clearTimeout(ringTimers.get(callId));
      ringTimers.delete(callId);
      io.to(`user:${call.callerId}`).emit("call:answered", { callId, answer, device: cleanDevice(device) });
      pushCallEnded(call.calleeId, callId, "answered").catch(() => {});
      // The callee may have several tabs/devices all ringing — silence the
      // ones that didn't pick up.
      socket.to(`user:${userId}`).emit("call:handled-elsewhere", { callId });
    });

    // Both sides relay ICE candidates through here. Only the two
    // participants of a live call may use it.
    socket.on("call:ice-candidate", ({ callId, candidate }) => {
      const call = activeCalls.get(callId);
      if (!call || !candidate) return;
      if (call.callerId !== userId && call.calleeId !== userId) return;
      const targetId = call.callerId === userId ? call.calleeId : call.callerId;
      if (targetId === call.calleeId && call.status === "ringing" && !onlineUsers.has(targetId)) {
        // callee's app is still starting — hold the candidates for it
        if (call.pendingIce.length < MAX_BUFFERED_ICE) call.pendingIce.push(candidate);
        return;
      }
      io.to(`user:${targetId}`).emit("call:ice-candidate", { callId, candidate });
    });

    // Mid-call renegotiation (ICE restart after a network change, camera
    // switch, ...). `description` is an SDP offer or answer.
    socket.on("call:signal", ({ callId, description }) => {
      const call = activeCalls.get(callId);
      if (!call || !description) return;
      if (call.callerId !== userId && call.calleeId !== userId) return;
      const targetId = call.callerId === userId ? call.calleeId : call.callerId;
      io.to(`user:${targetId}`).emit("call:signal", { callId, description });
    });

    // Tells the other side "my camera/mic is off" so their UI can show it
    // instead of a frozen/black frame.
    socket.on("call:media-state", ({ callId, muted, cameraOff }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      if (call.callerId !== userId && call.calleeId !== userId) return;
      const targetId = call.callerId === userId ? call.calleeId : call.callerId;
      io.to(`user:${targetId}`).emit("call:media-state", { callId, muted: !!muted, cameraOff: !!cameraOff });
    });

    // The phone was rotated / the window resized mid-call: tell the other side
    // so it can re-fit the picture.
    socket.on("call:device", ({ callId, device }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      if (call.callerId !== userId && call.calleeId !== userId) return;
      const targetId = call.callerId === userId ? call.calleeId : call.callerId;
      io.to(`user:${targetId}`).emit("call:device", { callId, device: cleanDevice(device) });
    });

    socket.on("call:decline", async ({ callId }) => {
      await declineCallById(io, userId, callId);
    });

    socket.on("call:end", async ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      if (call.callerId !== userId && call.calleeId !== userId) return;
      const otherId = call.callerId === userId ? call.calleeId : call.callerId;
      io.to(`user:${otherId}`).emit("call:ended", { callId });
      if (call.status === "ringing") pushCallEnded(call.calleeId, callId, "cancelled").catch(() => {});
      socket.to(`user:${userId}`).emit("call:handled-elsewhere", { callId });
      await finishCall(callId);
    });

    socket.on("disconnect", async () => {
      const set = onlineUsers.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          onlineUsers.delete(userId);
          await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: new Date() });
          contactIds.forEach((cid) =>
            io.to(`user:${cid}`).emit("presence:update", { userId, isOnline: false, lastSeen: new Date() })
          );

          // Dropped mid-call — give the connection a moment to come back
          // (wifi handoff, brief signal loss) before declaring the call
          // over and telling the other party.
          const callId = userActiveCall.get(userId);
          if (callId && activeCalls.has(callId)) {
            const call = activeCalls.get(callId);
            const otherId = call.callerId === userId ? call.calleeId : call.callerId;
            io.to(`user:${otherId}`).emit("call:peer-unstable", { callId });
            clearTimeout(dropTimers.get(userId));
            dropTimers.set(
              userId,
              setTimeout(async () => {
                dropTimers.delete(userId);
                if (onlineUsers.has(userId)) return; // came back
                const stillActive = activeCalls.get(callId);
                if (!stillActive) return;
                io.to(`user:${otherId}`).emit("call:ended", { callId, reason: "disconnected" });
                await finishCall(callId);
              }, CALL_DROP_GRACE_MS)
            );
          }
        }
      }
    });
  });
}
