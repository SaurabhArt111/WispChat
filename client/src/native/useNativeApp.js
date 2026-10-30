import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useCall } from "../context/CallContext";
import { backendOriginUrl } from "../api/config";
import { isNative, native } from "./wispNative";
import { registerPush } from "./push";
import { syncCallLog } from "./backup";

const ASKED_KEY = "wisp_notif_asked";

/**
 * Wires the Android shell to the web app. A no-op in a browser.
 *  • hands the login to the native side (notification buttons need it)
 *  • creates the WispChat folder, asks for notification permission
 *  • registers the push token; reacts to taps on notifications / "Accept" on a call
 *  • Back button: close sheets / go back, and minimise instead of quitting
 */
export default function useNativeApp() {
  const { user } = useAuth();
  const { activeId } = useChat();
  const { requestAutoAccept } = useCall();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const acceptRef = useRef(requestAutoAccept);
  acceptRef.current = requestAutoAccept;

  // Login ↔ native session, folder, permissions, push token.
  useEffect(() => {
    if (!isNative || !user?._id) return undefined;
    let cancelled = false;
    (async () => {
      const token = localStorage.getItem("wisp_token");
      if (token) await native.setSession(token, backendOriginUrl);
      await native.ensureStorage();
      if (cancelled) return;
      if (!localStorage.getItem(ASKED_KEY)) {
        localStorage.setItem(ASKED_KEY, "1");
        await native.requestNotificationPermission(); // Android 13+: system prompt
      }
      await registerPush();
      syncCallLog();
    })();
    const sub = native.onPushToken((t) => registerPush(t));
    return () => {
      cancelled = true;
      sub?.then?.((h) => h.remove());
    };
  }, [user?._id]);

  // What opened the app: a notification tap, or "Accept" on the incoming-call screen.
  useEffect(() => {
    if (!isNative || !user?._id) return undefined;
    async function handle() {
      const a = await native.getLaunchAction();
      if (!a) return;
      if (a.type === "open-chat" && a.conversationId) navigateRef.current(`/chat/${a.conversationId}`);
      if (a.type === "call-accept" && a.callId) acceptRef.current?.(a.callId);
    }
    handle();
    const subs = [
      native.onLaunchAction(handle),
      CapApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          handle();
          native.setActiveConversation(activeIdRef.current);
        }
      }),
    ];
    return () => subs.forEach((s) => s?.then?.((h) => h.remove()));
  }, [user?._id]);

  // The notification for the chat you're reading is dismissed.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  useEffect(() => {
    if (isNative) native.setActiveConversation(activeId);
  }, [activeId]);

  // Android Back: sheets and routes use browser history, so just go back; at the root, minimise like WhatsApp.
  useEffect(() => {
    if (!isNative) return undefined;
    const sub = CapApp.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else CapApp.minimizeApp();
    });
    return () => sub.then((h) => h.remove());
  }, []);
}
