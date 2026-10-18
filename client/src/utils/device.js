// ---------------------------------------------------------------------------
// Device detection for calls.
//
// A call between a phone and a computer has two very different pictures: a
// phone films a tall (portrait) frame, a laptop/desktop camera films a wide
// (landscape) one. Each side announces what it is so the other can lay the
// picture out sensibly, and the call screen additionally measures the REAL
// pixel size of every stream (see `useVideoShape` in CallOverlay), so the
// layout is right even if a phone is held sideways or a tablet is used.
// ---------------------------------------------------------------------------

export function getDeviceType() {
  if (typeof navigator === "undefined") return "desktop";
  const uaData = navigator.userAgentData;
  if (uaData && typeof uaData.mobile === "boolean" && uaData.mobile) return "mobile";
  const ua = navigator.userAgent || "";
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (/Android|iPhone|iPod|Mobile|Opera Mini|IEMobile/i.test(ua)) return "mobile";
  // iPadOS reports itself as a Mac — a touch screen gives it away.
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "tablet";
  return "desktop";
}

export function getScreenOrientation() {
  if (typeof window === "undefined") return "landscape";
  return window.innerHeight > window.innerWidth ? "portrait" : "landscape";
}

/** What we tell the other side about this device. */
export function getDeviceInfo() {
  return {
    type: getDeviceType(), // "mobile" | "tablet" | "desktop"
    orientation: getScreenOrientation(),
  };
}

export function deviceLabel(type) {
  if (type === "mobile") return "Phone";
  if (type === "tablet") return "Tablet";
  if (type === "desktop") return "Computer";
  return "";
}

/** Shape of a video frame from its pixel size. */
export function shapeOf(width, height) {
  if (!width || !height) return "unknown";
  const r = width / height;
  if (r > 1.08) return "landscape";
  if (r < 0.92) return "portrait";
  return "square";
}

/**
 * Camera constraints that match the device: a phone held upright captures a
 * tall 9:16 frame (no wasted landscape crop), a computer captures 16:9.
 */
export function videoConstraintsFor(device = getDeviceInfo()) {
  const base = { facingMode: "user", frameRate: { ideal: 24, max: 30 } };
  if (device.type === "mobile" && device.orientation === "portrait") {
    return { ...base, width: { ideal: 540, max: 720 }, height: { ideal: 960, max: 1280 }, aspectRatio: { ideal: 9 / 16 } };
  }
  if (device.type === "tablet" && device.orientation === "portrait") {
    return { ...base, width: { ideal: 600, max: 768 }, height: { ideal: 800, max: 1024 }, aspectRatio: { ideal: 3 / 4 } };
  }
  return { ...base, width: { ideal: 960, max: 1280 }, height: { ideal: 540, max: 720 }, aspectRatio: { ideal: 16 / 9 } };
}
