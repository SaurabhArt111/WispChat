import { createContext, useCallback, useContext, useEffect, useState } from "react";
import client from "../api/client";
import { useAuth } from "./AuthContext";
import useLiveRefresh from "../hooks/useLiveRefresh";

const StatusContext = createContext(null);

// Mirrors the server-side cap in statusController.js — surfaced here so
// the UI can disable/guard the "add status" affordance proactively instead
// of only finding out after a failed POST.
export const MAX_STATUSES = 5;

export function StatusProvider({ children }) {
  const { user } = useAuth();
  const [feed, setFeed] = useState([]); // [{ user, items: [...] }]
  const [loading, setLoading] = useState(true);

  const refreshFeed = useCallback(async () => {
    try {
      const res = await client.get("/status");
      setFeed(res.data.feed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) refreshFeed();
    else {
      setFeed([]);
      setLoading(false);
    }
  }, [user, refreshFeed]);

  // Statuses change constantly (new slides, views, reactions, expiry,
  // privacy edits, new contacts). Refresh on the server's push, on
  // reconnect/foreground, and once a minute so expired slides drop off.
  useLiveRefresh(refreshFeed, {
    events: ["status:changed", "contacts:changed", "user:updated"],
    pollMs: 60000,
    enabled: !!user,
  });

  const postTextStatus = useCallback(
    async (text, bgColor) => {
      await client.post("/status", { kind: "text", text, bgColor });
      await refreshFeed();
    },
    [refreshFeed]
  );

  const postMediaStatus = useCallback(
    async (blob, name, caption) => {
      const form = new FormData();
      form.append("kind", "media");
      form.append("file", blob, name);
      if (caption) form.append("caption", caption);
      await client.post("/status", form, { headers: { "Content-Type": "multipart/form-data" } });
      await refreshFeed();
    },
    [refreshFeed]
  );

  const markViewed = useCallback(async (statusId) => {
    // Update the list immediately so a contact moves to Viewed as soon as
    // their last unseen slide is opened, without waiting for a feed reload.
    setFeed((current) =>
      current.map((entry) => ({
        ...entry,
        items: entry.items.map((item) =>
          item._id === statusId ? { ...item, viewedByMe: true } : item
        ),
      }))
    );
    try {
      await client.post(`/status/${statusId}/view`);
    } catch {
      // Reconcile optimistic state with the server if the request failed.
      await refreshFeed();
    }
  }, [refreshFeed]);

  const deleteStatus = useCallback(
    async (statusId) => {
      await client.delete(`/status/${statusId}`);
      await refreshFeed();
    },
    [refreshFeed]
  );

  const reactToStatus = useCallback(
    async (statusId, emoji) => {
      const res = await client.post(`/status/${statusId}/react`, { emoji });
      await refreshFeed();
      return res.data;
    },
    [refreshFeed]
  );

  const myEntry = feed.find((f) => f.user._id === user?._id);
  const contactEntries = feed.filter((f) => f.user._id !== user?._id);
  const hasUnread = contactEntries.some((f) => f.items.some((i) => !i.viewedByMe));

  const value = {
    feed,
    loading,
    myEntry,
    contactEntries,
    hasUnread,
    refreshFeed,
    postTextStatus,
    postMediaStatus,
    markViewed,
    deleteStatus,
    reactToStatus,
  };

  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

export function useStatus() {
  return useContext(StatusContext);
}
