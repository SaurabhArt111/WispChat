import { useEffect, useRef } from "react";
import { useSocket } from "../context/SocketContext";

/**
 * Keeps a piece of server data fresh without the person ever reloading.
 *
 * `refresh` is (re)run:
 *   - when the socket (re)connects — catches everything missed while offline
 *   - whenever one of `events` arrives over the socket (debounced, so a burst
 *     of events costs one request)
 *   - when the tab/app returns to the foreground or the network comes back
 *   - optionally every `pollMs` while the tab is visible (safety net for
 *     events that could not be delivered)
 *
 * It does NOT run on mount — callers already load their data initially
 * (usually inside their own effect) and this only handles staying current.
 */
export default function useLiveRefresh(refresh, { events = [], pollMs = 0, debounceMs = 250, enabled = true } = {}) {
  const { socket } = useSocket();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const eventsKey = events.join("|");

  useEffect(() => {
    if (!enabled) return;
    let timer = null;
    let lastRun = 0;

    const run = () => {
      lastRun = Date.now();
      try {
        const out = refreshRef.current?.();
        if (out && typeof out.catch === "function") out.catch(() => {});
      } catch {
        /* a failed refresh must never break the UI */
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(run, debounceMs);
    };
    const onVisible = () => {
      // Throttle: switching tabs quickly shouldn't hammer the API.
      if (document.visibilityState === "visible" && Date.now() - lastRun > 4000) schedule();
    };
    const onOnline = () => schedule();

    let skipFirstConnect = socket?.connected;
    const onConnect = () => {
      // The first "connect" of an already-connected socket is not a reconnect.
      if (skipFirstConnect) {
        skipFirstConnect = false;
        return;
      }
      schedule();
    };

    const names = eventsKey ? eventsKey.split("|") : [];
    socket?.on("connect", onConnect);
    names.forEach((n) => socket?.on(n, schedule));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    const poll = pollMs
      ? setInterval(() => document.visibilityState === "visible" && schedule(), pollMs)
      : null;

    return () => {
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      socket?.off("connect", onConnect);
      names.forEach((n) => socket?.off(n, schedule));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [socket, eventsKey, pollMs, debounceMs, enabled]);
}
