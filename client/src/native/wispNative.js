// ---------------------------------------------------------------------------
// JS side of the Android plugin (android/app/src/main/java/.../WispNativePlugin.java).
//
// Everything here is a safe no-op in a normal browser / PWA, so the rest of the
// app can call `native.*` without checking the platform first.
// ---------------------------------------------------------------------------
import { Capacitor, registerPlugin } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

const Plugin = isNative ? registerPlugin("WispNative") : null;

async function call(method, args, fallback) {
  if (!Plugin) return fallback;
  try {
    return await Plugin[method](args);
  } catch (err) {
    if (import.meta.env.DEV) console.warn(`[native] ${method} failed:`, err?.message || err);
    return fallback;
  }
}

export const native = {
  isNative,

  // session / push
  setSession: (token, apiBase) => call("setSession", { token, apiBase }),
  clearSession: () => call("clearSession"),
  getPushToken: async () => (await call("getPushToken", undefined, null))?.token || null,
  onPushToken: (cb) => Plugin?.addListener("pushToken", (e) => cb(e.token)),
  onLaunchAction: (cb) => Plugin?.addListener("launchAction", cb),
  getLaunchAction: async () => (await call("getLaunchAction", undefined, null))?.action || null,
  setActiveConversation: (id) => call("setActiveConversation", { id: id || null }),
  clearNotifications: (conversationId) => call("clearNotifications", { conversationId }),

  // permissions / settings
  getNotificationStatus: () => call("getNotificationStatus", undefined, null),
  requestNotificationPermission: () => call("requestNotificationPermission", undefined, null),
  openSettings: (kind) => call("openSettings", { kind }),

  // background connection (notifications + calls with the app closed, no Firebase)
  setBackgroundEnabled: (enabled) => call("setBackgroundEnabled", { enabled }),
  getBackgroundStatus: () => call("getBackgroundStatus", undefined, null),
  requestIgnoreBatteryOptimizations: () => call("requestIgnoreBatteryOptimizations"),

  // native feel
  haptic: (kind) => call("haptic", { kind }),
  setSystemBarColor: (color) => call("setSystemBarColor", { color }),

  // calls
  startCallService: (title, video) => call("startCallService", { title, video: !!video }),
  stopCallService: () => call("stopCallService"),
  dismissIncomingCall: (callId) => call("dismissIncomingCall", { callId }),

  // storage (the WispChat folder)
  ensureStorage: () => call("ensureStorage", undefined, null),
  getStorageInfo: () => call("getStorageInfo", undefined, null),
  saveFileChunk: (args) => call("saveFileChunk", args, null),
  saveFromUrl: (args) => call("saveFromUrl", args, null),
  hasSavedFile: (key) => call("hasSavedFile", { key }, { saved: false }),
  writeText: (dir, name, content) => call("writeText", { dir, name, content }),
  readText: async (dir, name) => (await call("readText", { dir, name }, null))?.content ?? null,
  listFiles: async (dir) => (await call("listFiles", { dir }, { files: [] })).files || [],
  openFile: (path) => call("openFile", { path }),
  shareFile: (path) => call("shareFile", { path }),
};
