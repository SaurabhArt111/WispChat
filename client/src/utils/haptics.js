// A tiny vibration like a native control (Android app); falls back to the web Vibration API.
import { isNative, native } from "../native/wispNative";

const WEB = { tick: 6, click: 10, heavy: 22, success: [8, 40, 12], reject: [14, 30, 14] };

/** kind: tick | click | heavy | success | reject */
export function haptic(kind = "tick") {
  if (isNative) {
    native.haptic(kind);
    return;
  }
  try {
    navigator.vibrate?.(WEB[kind] ?? 8);
  } catch {
    /* unsupported */
  }
}
