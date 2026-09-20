import { createContext, useCallback, useContext, useEffect, useState } from "react";
import client from "../api/client";
import { useAuth } from "./AuthContext";

const StatusContext = createContext(null);

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
    try {
      await client.post(`/status/${statusId}/view`);
    } catch {
      // non-critical — worst case the view count/ring state is a bit stale
    }
  }, []);

  const deleteStatus = useCallback(
    async (statusId) => {
      await client.delete(`/status/${statusId}`);
      await refreshFeed();
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
  };

  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

export function useStatus() {
  return useContext(StatusContext);
}
