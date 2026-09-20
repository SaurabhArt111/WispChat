import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import client from "../api/client";
import { useAuth } from "./AuthContext";
import { useSocket } from "./SocketContext";

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const { user } = useAuth();
  const { socket } = useSocket();

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messagesByConv, setMessagesByConv] = useState({});
  const [hasMoreByConv, setHasMoreByConv] = useState({});
  const [typingByConv, setTypingByConv] = useState({});
  const [presence, setPresence] = useState({});
  const [loadingConversations, setLoadingConversations] = useState(true);

  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const refreshConversations = useCallback(async () => {
    const res = await client.get("/conversations");
    setConversations(res.data.conversations);
    setLoadingConversations(false);
  }, []);

  useEffect(() => {
    if (user) refreshConversations();
    else {
      setConversations([]);
      setMessagesByConv({});
      setActiveId(null);
    }
  }, [user, refreshConversations]);

  const upsertConversation = useCallback((conv) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c._id === conv._id);
      if (idx === -1) return [conv, ...prev];
      const next = [...prev];
      next[idx] = { ...next[idx], ...conv };
      next.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
      return next;
    });
  }, []);

  const loadMessages = useCallback(async (conversationId, before) => {
    const res = await client.get(`/messages/${conversationId}`, { params: before ? { before } : {} });
    setMessagesByConv((prev) => {
      const existing = prev[conversationId] || [];
      const incoming = res.data.messages;
      const merged = before ? [...incoming, ...existing] : incoming;
      const seen = new Set();
      const dedup = merged.filter((m) => (seen.has(m._id) ? false : (seen.add(m._id), true)));
      return { ...prev, [conversationId]: dedup };
    });
    setHasMoreByConv((prev) => ({ ...prev, [conversationId]: res.data.hasMore }));
  }, []);

  const openConversation = useCallback(
    async (conversationId) => {
      if (!conversationId) {
        setActiveId(null);
        return;
      }
      setActiveId(conversationId);
      if (!messagesByConv[conversationId]) {
        await loadMessages(conversationId);
      }
      client.post(`/messages/${conversationId}/read`).catch(() => {});
      socket?.emit("conversation:join", { conversationId });
      setConversations((prev) => prev.map((c) => (c._id === conversationId ? { ...c, unreadCount: 0 } : c)));
    },
    [loadMessages, messagesByConv, socket]
  );

  const sendMessage = useCallback(async (conversationId, payload) => {
    const clientId = payload.clientId || `c${Date.now()}${Math.random().toString(36).slice(2)}`;
    const optimistic = {
      _id: `optimistic-${clientId}`,
      conversation: conversationId,
      sender: { _id: "me", ...payload.selfPreview },
      text: payload.text || "",
      attachments: payload.attachments || [],
      replyTo: payload.replyToMessage || null,
      reactions: [],
      createdAt: new Date().toISOString(),
      pending: true,
      clientId,
    };
    setMessagesByConv((prev) => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] || []), optimistic],
    }));

    try {
      const res = await client.post(`/messages/${conversationId}`, {
        text: payload.text,
        attachments: payload.attachments,
        replyTo: payload.replyTo,
        clientId,
      });
      setMessagesByConv((prev) => ({
        ...prev,
        [conversationId]: (prev[conversationId] || []).map((m) =>
          m._id === optimistic._id ? res.data.message : m
        ),
      }));
      upsertConversation({ ...conversations.find((c) => c._id === conversationId), lastMessage: res.data.message, lastMessageAt: res.data.message.createdAt });
    } catch (err) {
      setMessagesByConv((prev) => ({
        ...prev,
        [conversationId]: (prev[conversationId] || []).map((m) =>
          m._id === optimistic._id ? { ...m, pending: false, failed: true } : m
        ),
      }));
    }
  }, [conversations, upsertConversation]);

  // Patch a single message into local state wherever it lives, by id. Used so the
  // person taking an action (editing, reacting, forwarding) sees it applied instantly
  // from the API's own response — the socket echo is what syncs it to *other* people,
  // not what the actor should have to wait on.
  const applyMessagePatch = useCallback((msg) => {
    setMessagesByConv((prev) => {
      const list = prev[msg.conversation];
      if (!list) return prev;
      return { ...prev, [msg.conversation]: list.map((m) => (m._id === msg._id ? msg : m)) };
    });
  }, []);

  const editMessage = useCallback(
    async (id, text) => {
      const res = await client.patch(`/messages/msg/${id}`, { text });
      applyMessagePatch(res.data.message);
    },
    [applyMessagePatch]
  );

  // Deleting a message doesn't hit the server immediately: it's marked
  // `pendingDelete` locally and a 3s timer starts. MessageBubble renders a
  // "Deleting…" placeholder in the meantime, and the Undo action on the
  // toast (see requestDeleteMessage callers) cancels the timer and restores
  // the message before it's ever actually deleted server-side.
  const pendingDeleteTimers = useRef({});

  const patchPendingDelete = useCallback((id, patch) => {
    setMessagesByConv((prev) => {
      const next = { ...prev };
      for (const convId of Object.keys(next)) {
        next[convId] = next[convId].map((m) => (m._id === id ? { ...m, ...patch } : m));
      }
      return next;
    });
  }, []);

  const finalizeDelete = useCallback(async (id, forEveryone) => {
    try {
      await client.delete(`/messages/msg/${id}`, { data: { forEveryone } });
    } catch {
      // If the network call fails, leave the message visibly stuck in
      // "Deleting…" would be confusing — just drop the pending flag so it
      // reappears as normal and the user can retry.
      patchPendingDelete(id, { pendingDelete: false });
      return;
    }
    setMessagesByConv((prev) => {
      const next = { ...prev };
      for (const convId of Object.keys(next)) {
        if (forEveryone) {
          next[convId] = next[convId].map((m) =>
            m._id === id
              ? { ...m, deletedForEveryone: true, text: "", attachments: [], pendingDelete: false }
              : m
          );
        } else {
          next[convId] = next[convId].filter((m) => m._id !== id);
        }
      }
      return next;
    });
  }, [patchPendingDelete]);

  const requestDeleteMessage = useCallback(
    (id, forEveryone) => {
      patchPendingDelete(id, { pendingDelete: true, pendingDeleteForEveryone: forEveryone });
      pendingDeleteTimers.current[id] = setTimeout(() => {
        delete pendingDeleteTimers.current[id];
        finalizeDelete(id, forEveryone);
      }, 3000);
    },
    [patchPendingDelete, finalizeDelete]
  );

  const undoDeleteMessage = useCallback(
    (id) => {
      const timer = pendingDeleteTimers.current[id];
      if (timer) {
        clearTimeout(timer);
        delete pendingDeleteTimers.current[id];
      }
      patchPendingDelete(id, { pendingDelete: false, pendingDeleteForEveryone: undefined });
    },
    [patchPendingDelete]
  );

  // Kept for any internal/programmatic use that wants an immediate,
  // non-undoable delete (not exposed to the delete-confirmation UI).
  const deleteMessage = useCallback(async (id, forEveryone) => {
    await client.delete(`/messages/msg/${id}`, { data: { forEveryone } });
    setMessagesByConv((prev) => {
      const next = { ...prev };
      for (const convId of Object.keys(next)) {
        if (forEveryone) {
          next[convId] = next[convId].map((m) =>
            m._id === id ? { ...m, deletedForEveryone: true, text: "", attachments: [] } : m
          );
        } else {
          next[convId] = next[convId].filter((m) => m._id !== id);
        }
      }
      return next;
    });
  }, []);

  const reactToMessage = useCallback(
    async (id, emoji) => {
      const res = await client.post(`/messages/msg/${id}/react`, { emoji });
      applyMessagePatch(res.data.message);
    },
    [applyMessagePatch]
  );

  const forwardMessage = useCallback(async (id, conversationIds) => {
    const res = await client.post(`/messages/msg/${id}/forward`, { conversationIds });
    res.data.messages.forEach((msg) => {
      setMessagesByConv((prev) => {
        const list = prev[msg.conversation];
        if (!list) return prev; // target conversation isn't loaded — fine, it'll load fresh when opened
        if (list.some((m) => m._id === msg._id)) return prev;
        return { ...prev, [msg.conversation]: [...list, msg] };
      });
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c._id === msg.conversation);
        if (idx === -1) return prev; // don't fabricate a partial conversation entry
        const next = [...prev];
        next[idx] = { ...next[idx], lastMessage: msg, lastMessageAt: msg.createdAt };
        next.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
        return next;
      });
    });
  }, []);

  const startDirectConversation = useCallback(
    async (userId) => {
      const res = await client.post("/conversations/direct", { userId });
      upsertConversation(res.data.conversation);
      return res.data.conversation;
    },
    [upsertConversation]
  );

  const createGroup = useCallback(
    async (name, participantIds, description) => {
      const res = await client.post("/conversations/group", { name, participantIds, description });
      upsertConversation(res.data.conversation);
      return res.data.conversation;
    },
    [upsertConversation]
  );

  // --- Socket event wiring ---
  useEffect(() => {
    if (!socket) return;

    const onNewMessage = (msg) => {
      setMessagesByConv((prev) => {
        const list = prev[msg.conversation] || [];
        if (list.some((m) => m._id === msg._id || (m.clientId && m.clientId === msg.clientId))) {
          return { ...prev, [msg.conversation]: list.map((m) => (m.clientId === msg.clientId ? msg : m)) };
        }
        return { ...prev, [msg.conversation]: [...list, msg] };
      });
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c._id === msg.conversation);
        const isActive = activeIdRef.current === msg.conversation;
        const isMine = msg.sender?._id === user?._id;
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          lastMessage: msg,
          lastMessageAt: msg.createdAt,
          unreadCount: isActive || isMine ? next[idx].unreadCount || 0 : (next[idx].unreadCount || 0) + 1,
        };
        next.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
        return next;
      });
      if (activeIdRef.current === msg.conversation && msg.sender?._id !== user?._id) {
        client.post(`/messages/${msg.conversation}/read`).catch(() => {});
      }
    };

    const onEdited = (msg) => {
      setMessagesByConv((prev) => ({
        ...prev,
        [msg.conversation]: (prev[msg.conversation] || []).map((m) => (m._id === msg._id ? msg : m)),
      }));
    };

    const onDeleted = ({ id, forEveryone }) => {
      setMessagesByConv((prev) => {
        const next = { ...prev };
        for (const convId of Object.keys(next)) {
          if (forEveryone) {
            next[convId] = next[convId].map((m) =>
              m._id === id ? { ...m, deletedForEveryone: true, text: "", attachments: [] } : m
            );
          } else {
            next[convId] = next[convId].filter((m) => m._id !== id);
          }
        }
        return next;
      });
    };

    const onReaction = (msg) => {
      setMessagesByConv((prev) => ({
        ...prev,
        [msg.conversation]: (prev[msg.conversation] || []).map((m) => (m._id === msg._id ? msg : m)),
      }));
    };

    const onRead = ({ conversationId, userId }) => {
      setMessagesByConv((prev) => ({
        ...prev,
        [conversationId]: (prev[conversationId] || []).map((m) =>
          m.readBy?.includes(userId) ? m : { ...m, readBy: [...(m.readBy || []), userId] }
        ),
      }));
    };

    const onTyping = ({ conversationId, userId, displayName, typing }) => {
      setTypingByConv((prev) => {
        const current = { ...(prev[conversationId] || {}) };
        if (typing) current[userId] = displayName;
        else delete current[userId];
        return { ...prev, [conversationId]: current };
      });
    };

    const onPresence = ({ userId, isOnline, lastSeen }) => {
      setPresence((prev) => ({ ...prev, [userId]: { isOnline, lastSeen } }));
    };

    const onConversationNew = (conv) => upsertConversation(conv);
    const onConversationUpdated = (conv) => upsertConversation(conv);

    socket.on("message:new", onNewMessage);
    socket.on("message:edited", onEdited);
    socket.on("message:deleted", onDeleted);
    socket.on("message:reaction", onReaction);
    socket.on("message:read", onRead);
    socket.on("typing:update", onTyping);
    socket.on("presence:update", onPresence);
    socket.on("conversation:new", onConversationNew);
    socket.on("conversation:updated", onConversationUpdated);

    return () => {
      socket.off("message:new", onNewMessage);
      socket.off("message:edited", onEdited);
      socket.off("message:deleted", onDeleted);
      socket.off("message:reaction", onReaction);
      socket.off("message:read", onRead);
      socket.off("typing:update", onTyping);
      socket.off("presence:update", onPresence);
      socket.off("conversation:new", onConversationNew);
      socket.off("conversation:updated", onConversationUpdated);
    };
  }, [socket, user, upsertConversation]);

  const value = {
    conversations,
    loadingConversations,
    activeId,
    activeConversation: conversations.find((c) => c._id === activeId) || null,
    messages: messagesByConv[activeId] || [],
    hasMore: hasMoreByConv[activeId] ?? false,
    typing: typingByConv[activeId] || {},
    presence,
    openConversation,
    closeActiveChat: () => setActiveId(null),
    loadMoreMessages: (before) => loadMessages(activeId, before),
    sendMessage,
    editMessage,
    deleteMessage,
    requestDeleteMessage,
    undoDeleteMessage,
    reactToMessage,
    forwardMessage,
    startDirectConversation,
    createGroup,
    refreshConversations,
    upsertConversation,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  return useContext(ChatContext);
}
