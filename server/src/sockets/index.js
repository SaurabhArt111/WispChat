import { verifyToken } from "../utils/jwt.js";
import User from "../models/User.js";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

const onlineUsers = new Map(); // userId -> Set(socketIds)

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

  io.on("connection", async (socket) => {
    const userId = String(socket.user._id);
    socket.join(`user:${userId}`);

    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    await User.findByIdAndUpdate(userId, { isOnline: true });

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

    socket.on("call:invite", async ({ callId, calleeId, conversationId, kind, offer }) => {
      if (!callId || !calleeId || !conversationId || !offer) return;

      // Already on a call (either side) — auto-busy instead of ringing.
      if (userActiveCall.has(calleeId) || userActiveCall.has(userId)) {
        socket.emit("call:busy", { callId });
        return;
      }
      if (!onlineUsers.has(calleeId)) {
        // Callee isn't connected at all right now — ring for nobody,
        // just log it as missed immediately.
        socket.emit("call:unavailable", { callId });
        await logCallMessage(io, { conversationId, callerId: userId, kind, status: "missed" });
        return;
      }

      activeCalls.set(callId, {
        callerId: userId,
        calleeId,
        conversationId,
        kind,
        status: "ringing",
        startedAt: Date.now(),
      });
      userActiveCall.set(userId, callId);
      userActiveCall.set(calleeId, callId);

      io.to(`user:${calleeId}`).emit("call:incoming", {
        callId,
        conversationId,
        kind,
        offer,
        from: { _id: socket.user._id, displayName: socket.user.displayName, avatar: socket.user.avatar, avatarColor: socket.user.avatarColor },
      });

      // No answer within 45s — treat as missed, same as a phone ringing out.
      setTimeout(async () => {
        const call = activeCalls.get(callId);
        if (call && call.status === "ringing") {
          activeCalls.delete(callId);
          userActiveCall.delete(call.callerId);
          userActiveCall.delete(call.calleeId);
          io.to(`user:${call.callerId}`).emit("call:timeout", { callId });
          io.to(`user:${call.calleeId}`).emit("call:timeout", { callId });
          await logCallMessage(io, { conversationId: call.conversationId, callerId: call.callerId, kind: call.kind, status: "missed" });
        }
      }, 45000);
    });

    socket.on("call:answer", ({ callId, answer }) => {
      const call = activeCalls.get(callId);
      if (!call || call.calleeId !== userId) return;
      call.status = "connected";
      call.connectedAt = Date.now();
      io.to(`user:${call.callerId}`).emit("call:answered", { callId, answer });
    });

    socket.on("call:ice-candidate", ({ callId, candidate, to }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      const targetId = to || (call.callerId === userId ? call.calleeId : call.callerId);
      io.to(`user:${targetId}`).emit("call:ice-candidate", { callId, candidate });
    });

    socket.on("call:decline", async ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      activeCalls.delete(callId);
      userActiveCall.delete(call.callerId);
      userActiveCall.delete(call.calleeId);
      io.to(`user:${call.callerId}`).emit("call:declined", { callId });
      await logCallMessage(io, { conversationId: call.conversationId, callerId: call.callerId, kind: call.kind, status: "declined" });
    });

    socket.on("call:end", async ({ callId }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      activeCalls.delete(callId);
      userActiveCall.delete(call.callerId);
      userActiveCall.delete(call.calleeId);
      const otherId = call.callerId === userId ? call.calleeId : call.callerId;
      io.to(`user:${otherId}`).emit("call:ended", { callId });

      const wasConnected = !!call.connectedAt;
      const durationSec = wasConnected ? Math.round((Date.now() - call.connectedAt) / 1000) : 0;
      await logCallMessage(io, {
        conversationId: call.conversationId,
        callerId: call.callerId,
        kind: call.kind,
        status: wasConnected ? "completed" : "missed",
        durationSec,
      });
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

          // Dropped mid-call — tell the other party rather than leaving
          // them hanging on a connection that will never recover.
          const callId = userActiveCall.get(userId);
          if (callId) {
            const call = activeCalls.get(callId);
            if (call) {
              activeCalls.delete(callId);
              userActiveCall.delete(call.callerId);
              userActiveCall.delete(call.calleeId);
              const otherId = call.callerId === userId ? call.calleeId : call.callerId;
              io.to(`user:${otherId}`).emit("call:ended", { callId, reason: "disconnected" });
              const wasConnected = !!call.connectedAt;
              const durationSec = wasConnected ? Math.round((Date.now() - call.connectedAt) / 1000) : 0;
              await logCallMessage(io, {
                conversationId: call.conversationId,
                callerId: call.callerId,
                kind: call.kind,
                status: wasConnected ? "completed" : "missed",
                durationSec,
              });
            }
          }
        }
      }
    });
  });
}
