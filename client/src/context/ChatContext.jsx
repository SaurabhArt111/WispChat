import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "./AuthContext";
import { useSocket } from "./SocketContext";
import { uploadFiles, uploadPreparedFiles } from "../api/upload";
import { decryptBytesWithKey, encryptBytesWithKey } from "../utils/crypto";
import { compressItems } from "../utils/mediaCompressor";
import { mediaUrl } from "../api/config";

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const { user, e2ee } = useAuth();
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

  const navigate = useNavigate();
  const location = useLocation();

  // Loads a conversation's data and marks it active — but doesn't touch the
  // URL. This is the low-level "activate" step, driven off the current
  // route (see the sync effect below) rather than called directly by UI.
  const activateConversation = useCallback(
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

  // Public entry point used throughout the UI: pushes /chat/:id onto the
  // URL so a conversation is a real, shareable/back-button-able route. The
  // actual data load happens in the effect below, reacting to the URL
  // rather than being called imperatively — that way a browser back/forward
  // navigation or a direct link to /chat/:id activates the conversation too,
  // not just a click inside the app.
  const openConversation = useCallback(
    (conversationId) => {
      if (!conversationId) {
        setActiveId(null);
        return;
      }
      navigate(`/chat/${conversationId}`);
    },
    [navigate]
  );

  useEffect(() => {
    const match = location.pathname.match(/^\/chat\/([^/]+)/);
    const routeId = match ? match[1] : null;
    if (routeId !== activeIdRef.current) {
      activateConversation(routeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]
  );

  const sendMessage = useCallback(
    async (conversationId, payload) => {
      const clientId = payload.clientId || `c${Date.now()}${Math.random().toString(36).slice(2)}`;
      // When called from sendMediaMessage below, an optimistic bubble
      // already exists (it was shown the instant Send was tapped, before
      // compression/upload even started) — reuse it instead of creating a
      // second one.
      let optimisticId = payload._optimisticId;
      if (!optimisticId) {
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
        optimisticId = optimistic._id;
        setMessagesByConv((prev) => ({
          ...prev,
          [conversationId]: [...(prev[conversationId] || []), optimistic],
        }));
      }

      try {
        // Media sends build their own envelope earlier (so the same key can
        // encrypt the attachment bytes before upload); a text-only send
        // builds one here.
        const conversation = conversations.find((c) => c._id === conversationId);
        const envelope = payload.envelope || (await e2ee.prepareEnvelope(conversation));
        const { text, encrypted, iv, keys } = await e2ee.encryptOutgoingText(envelope, payload.text || "");

        const res = await client.post(`/messages/${conversationId}`, {
          text,
          attachments: payload.attachments,
          replyTo: payload.replyTo,
          clientId,
          encrypted,
          iv,
          keys,
        });
        setMessagesByConv((prev) => ({
          ...prev,
          [conversationId]: (prev[conversationId] || []).map((m) => (m._id === optimisticId ? res.data.message : m)),
        }));
        upsertConversation({
          ...conversations.find((c) => c._id === conversationId),
          lastMessage: res.data.message,
          lastMessageAt: res.data.message.createdAt,
        });
      } catch (err) {
        setMessagesByConv((prev) => ({
          ...prev,
          [conversationId]: (prev[conversationId] || []).map((m) =>
            m._id === optimisticId ? { ...m, pending: false, failed: true } : m
          ),
        }));
        throw err;
      }
    },
    [conversations, upsertConversation, e2ee]
  );

  // Used by the media composer/status editor. Unlike sendMessage, this
  // shows the pending bubble *immediately* — with local (uncompressed)
  // thumbnails and a per-attachment progress indicator — and only then
  // compresses, encrypts and uploads in the background. Compression of a
  // large video can take a while; nothing about that should block the UI
  // or make sending feel stuck, so the composer closes and the message
  // shows up as "sending" right away, the same way WhatsApp/Telegram do
  // it.
  const sendMediaMessage = useCallback(
    async (conversationId, { items, caption, replyTo, replyToMessage, asDocument }) => {
      const clientId = `c${Date.now()}${Math.random().toString(36).slice(2)}`;
      const localItems = items.map((it, i) => ({
        localId: `${clientId}-${i}`,
        blob: it.blob,
        name: it.name,
        kind: it.kind,
        localUrl: URL.createObjectURL(it.blob),
      }));

      const optimistic = {
        _id: `optimistic-${clientId}`,
        conversation: conversationId,
        sender: { _id: "me", ...user },
        text: caption || "",
        attachments: localItems.map((it) => ({
          _local: true,
          localId: it.localId,
          localUrl: it.localUrl,
          kind: it.kind,
          name: it.name,
          mimeType: it.blob.type,
          size: it.blob.size,
          progress: 0,
          stage: asDocument ? "uploading" : "compressing",
        })),
        replyTo: replyToMessage || null,
        reactions: [],
        createdAt: new Date().toISOString(),
        pending: true,
        clientId,
      };

      setMessagesByConv((prev) => ({
        ...prev,
        [conversationId]: [...(prev[conversationId] || []), optimistic],
      }));

      function patchAttachment(localId, patch) {
        setMessagesByConv((prev) => {
          const list = prev[conversationId];
          if (!list) return prev;
          return {
            ...prev,
            [conversationId]: list.map((m) =>
              m._id !== optimistic._id
                ? m
                : { ...m, attachments: m.attachments.map((a) => (a.localId === localId ? { ...a, ...patch } : a)) }
            ),
          };
        });
      }

      try {
        let finalBlobs = localItems.map((it) => it.blob);
        if (!asDocument) {
          finalBlobs = await compressItems(
            localItems.map((it) => ({ id: it.localId, blob: it.blob })),
            (localId, p) => patchAttachment(localId, { progress: p * 0.7, stage: "compressing" })
          );
        }

        localItems.forEach((it) => patchAttachment(it.localId, { progress: asDocument ? 0 : 0.7, stage: "uploading" }));

        const conversation = conversations.find((c) => c._id === conversationId);
        const envelope = await e2ee.prepareEnvelope(conversation);

        const attachments = await uploadFiles(
          localItems.map((it, i) => ({ blob: finalBlobs[i], name: it.name, kind: it.kind })),
          {
            envelope,
            asDocument,
            onUploadProgress: (fraction) =>
              localItems.forEach((it) => patchAttachment(it.localId, { progress: 0.7 + fraction * 0.3 })),
          }
        );

        localItems.forEach((it) => URL.revokeObjectURL(it.localUrl));

        await sendMessage(conversationId, {
          text: caption,
          attachments,
          replyTo,
          replyToMessage,
          envelope,
          clientId,
          _optimisticId: optimistic._id,
        });
      } catch (err) {
        localItems.forEach((it) => URL.revokeObjectURL(it.localUrl));
        setMessagesByConv((prev) => ({
          ...prev,
          [conversationId]: (prev[conversationId] || []).map((m) =>
            m._id === optimistic._id ? { ...m, pending: false, failed: true } : m
          ),
        }));
      }
    },
    [conversations, e2ee, sendMessage, user]
  );

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
      // Find which conversation this message lives in so we know who to
      // (re-)encrypt for — edits get a brand new per-message key/envelope,
      // same as an original send.
      let conversationId = null;
      for (const [convId, list] of Object.entries(messagesByConv)) {
        if (list.some((m) => m._id === id)) {
          conversationId = convId;
          break;
        }
      }
      const conversation = conversations.find((c) => c._id === conversationId);
      const envelope = await e2ee.prepareEnvelope(conversation);
      const encoded = await e2ee.encryptOutgoingText(envelope, text);

      const res = await client.patch(`/messages/msg/${id}`, encoded);
      applyMessagePatch(res.data.message);
    },
    [applyMessagePatch, conversations, messagesByConv, e2ee]
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

  // `message` is the full message object (not just an id) because an
  // encrypted message's ciphertext is scoped to its *original*
  // conversation's participants — forwarding it means decrypting it here
  // and building a brand new envelope per destination, the same as
  // composing a fresh message. Plain, unencrypted messages still take the
  // cheap "just copy it" path server-side.
  const forwardMessage = useCallback(
    async (message, conversationIds) => {
      function applyResults(messages) {
        messages.forEach((msg) => {
          setMessagesByConv((prev) => {
            const list = prev[msg.conversation];
            if (!list) return prev;
            if (list.some((m) => m._id === msg._id)) return prev;
            return { ...prev, [msg.conversation]: [...list, msg] };
          });
          setConversations((prev) => {
            const idx = prev.findIndex((c) => c._id === msg.conversation);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], lastMessage: msg, lastMessageAt: msg.createdAt };
            next.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
            return next;
          });
        });
      }

      if (!message.encrypted) {
        const res = await client.post(`/messages/msg/${message._id}/forward`, { conversationIds });
        applyResults(res.data.messages);
        return;
      }

      const { text: plainText, mk, locked } = await e2ee.decryptMessageText(message);
      if (locked) throw new Error("This message is locked and can't be forwarded on this device yet.");

      // Decrypt each attachment's bytes once up front; they get
      // re-encrypted fresh per destination below.
      const plainAttachments = await Promise.all(
        (message.attachments || []).map(async (a) => {
          if (!a.encrypted) return { meta: a, buffer: null };
          const res = await fetch(mediaUrl(a.url));
          const cipherBuffer = await res.arrayBuffer();
          const buffer = await decryptBytesWithKey(mk, cipherBuffer, a.iv);
          return { meta: a, buffer };
        })
      );

      const items = await Promise.all(
        conversationIds.map(async (convId) => {
          const conv = conversations.find((c) => c._id === convId);
          const envelope = await e2ee.prepareEnvelope(conv);
          const encodedText = await e2ee.encryptOutgoingText(envelope, plainText);

          let attachments = [];
          if (plainAttachments.length) {
            const prepared = await Promise.all(
              plainAttachments.map(async ({ meta, buffer }) => {
                const mimeType = meta.mimeType || "application/octet-stream";
                if (buffer && envelope.canEncrypt) {
                  const { ciphertext, iv } = await encryptBytesWithKey(envelope.mk, buffer);
                  return { blob: new Blob([ciphertext], { type: mimeType }), name: meta.name, mimeType, encrypted: true, iv };
                }
                if (buffer) {
                  return { blob: new Blob([buffer], { type: mimeType }), name: meta.name, mimeType, encrypted: false, iv: null };
                }
                const res = await fetch(mediaUrl(meta.url));
                const blob = await res.blob();
                return { blob, name: meta.name, mimeType, encrypted: false, iv: null };
              })
            );
            attachments = await uploadPreparedFiles(prepared, { asDocument: !!message.attachments?.[0]?.asDocument });
          }

          return {
            conversationId: convId,
            text: encodedText.text,
            encrypted: encodedText.encrypted,
            iv: encodedText.iv,
            keys: encodedText.keys,
            attachments,
          };
        })
      );

      const res = await client.post(`/messages/msg/${message._id}/forward`, { items });
      applyResults(res.data.messages);
    },
    [conversations, e2ee]
  );

  const startDirectConversation = useCallback(
    async (userId) => {
      const res = await client.post("/conversations/direct", { userId });
      upsertConversation(res.data.conversation);
      return res.data.conversation;
    },
    [upsertConversation]
  );

  const createGroup = useCallback(
    async (name, participantIds, description, avatar) => {
      const res = await client.post("/conversations/group", { name, participantIds, description, avatar });
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
    closeActiveChat: () => navigate("/"),
    loadMoreMessages: (before) => loadMessages(activeId, before),
    sendMessage,
    sendMediaMessage,
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
