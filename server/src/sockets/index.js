import { verifyToken } from "../utils/jwt.js";
import User from "../models/User.js";
import Conversation from "../models/Conversation.js";

const onlineUsers = new Map(); // userId -> Set(socketIds)

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
        }
      }
    });
  });
}
