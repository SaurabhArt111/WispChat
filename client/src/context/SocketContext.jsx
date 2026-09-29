import { createContext, useContext, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "./AuthContext";
import { socketUrl } from "../api/config";

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user, setUser } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user) {
      setSocket(null);
      setConnected(false);
      return;
    }

    const token = localStorage.getItem("wisp_token");
    const s = io(socketUrl, {
      path: "/socket.io",
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      reconnectionAttempts: Infinity,
      timeout: 10000,
    });

    // Profile / privacy changes made on another tab or device of this same
    // account (and the server's authoritative copy) sync into local state.
    s.on("me:updated", ({ user: next }) => {
      if (!next) return;
      setUser((prev) => (prev ? { ...prev, ...next, e2ee: next.e2ee || prev.e2ee } : prev));
    });

    // Mobile browsers freeze background tabs and silently kill their
    // websockets; when the app comes back, reconnect immediately rather than
    // waiting for the next backoff tick.
    const wake = () => {
      if (document.visibilityState === "visible" && !s.connected) s.connect();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    s.wakeCleanup = () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", (err) => {
      console.warn("[socket] connection error:", err.message);
      setConnected(false);
    });
    setSocket(s);

    return () => {
      s.wakeCleanup?.();
      s.disconnect();
      setSocket(null);
    };
  }, [user?._id]);

  return <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
