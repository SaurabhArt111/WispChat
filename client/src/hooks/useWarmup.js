import { useEffect, useRef } from "react";
import { useChat } from "../context/ChatContext";
import { useAuth } from "../context/AuthContext";
import { readCachedMessages } from "../utils/messageCache";
import { mediaUrl } from "../api/config";

const idle = (fn, timeout = 3000) =>
  typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(fn, { timeout }) : setTimeout(fn, 800);

function preloadImage(url) {
  if (!url) return;
  const img = new Image();
  img.decoding = "async";
  img.src = url; // the browser cache keeps it; the real <img> then paints on first frame
}

/**
 * Once the chat list is in, quietly get the most recent chats ready while the
 * phone is idle: their messages (into memory + on-device DB) and the avatars /
 * photos on screen first. Opening a chat is then instant — no blank frame, no
 * skeleton, no image pop-in. Skipped on data-saver connections.
 */
export default function useWarmup() {
  const { conversations, prefetchMessages } = useChat();
  const { user } = useAuth();
  const doneRef = useRef(new Set());

  const ready = conversations.length > 0;
  useEffect(() => {
    if (!ready || navigator.connection?.saveData) return undefined;
    let cancelled = false;
    const handle = idle(async () => {
      for (const c of conversations.slice(0, 8)) {
        if (cancelled) return;
        // avatars first (cheap), then messages, then the newest photos
        (c.participants || []).forEach((p) => preloadImage(p?.avatar ? mediaUrl(p.avatar) : null));
        preloadImage(c.avatar ? mediaUrl(c.avatar) : null);
        if (!doneRef.current.has(c._id)) {
          doneRef.current.add(c._id);
          await prefetchMessages(c._id);
          const msgs = (user && readCachedMessages(user._id, c._id)) || [];
          msgs
            .slice(-30)
            .flatMap((m) => (m.attachments || []).filter((a) => a.kind === "image" && !a.encrypted && a.url))
            .slice(-4)
            .forEach((a) => preloadImage(mediaUrl(a.url)));
        }
        await new Promise((r) => setTimeout(r, 250)); // never hog the main thread
      }
    });
    return () => {
      cancelled = true;
      (window.cancelIdleCallback || clearTimeout)(handle);
    };
    // only when the list first becomes available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}
