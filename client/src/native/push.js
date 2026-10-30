import client from "../api/client";
import { native, isNative } from "./wispNative";

const KEY = "wisp_push_token";

/** Send this phone's Firebase token to the server so it can push messages / calls to it. */
export async function registerPush(token) {
  if (!isNative) return false;
  const t = token || (await native.getPushToken());
  if (!t) return false; // Firebase not configured in this build, or no network yet
  try {
    await client.post("/users/push-token", { token: t });
    localStorage.setItem(KEY, t);
    return true;
  } catch {
    return false;
  }
}

/** Called on logout: this phone must stop receiving the account's notifications. */
export async function unregisterPush() {
  if (!isNative) return;
  const t = localStorage.getItem(KEY);
  try {
    if (t) await client.delete("/users/push-token", { data: { token: t }, timeout: 4000 });
  } catch {
    /* the server also drops a token when another account registers it */
  }
  localStorage.removeItem(KEY);
  await native.clearSession();
}
