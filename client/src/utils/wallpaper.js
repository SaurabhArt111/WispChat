// Chat wallpaper storage: a global default (set in Settings → Chats) that
// applies to every conversation, plus an optional per-chat override (set
// from a chat's "More" menu) that wins over the default for that one
// conversation only. Both live in localStorage — wallpapers are a per-device
// display preference, not data that needs to sync across devices or be
// visible to the other participant.

const DEFAULT_KEY = "wisp_wallpaper_default";
const PER_CHAT_PREFIX = "wisp_wallpaper_chat_";
const CHANGE_EVENT = "wisp:wallpaper-change";

// A handful of built-in gradients/patterns plus "solid" and "none" (falls
// back to the theme's plain chat background). `custom` wallpapers (a
// person's own uploaded photo) are stored as a data URL directly in the
// same slot, so any of these ids OR a "data:" URL are valid stored values.
export const WALLPAPER_PRESETS = [
  { id: "none", label: "Default", css: "" },
  { id: "midnight", label: "Midnight", css: "radial-gradient(circle at 20% 20%, #163a33 0%, #0b1614 60%)" },
  { id: "emerald", label: "Emerald Haze", css: "radial-gradient(circle at 80% 0%, #114b3c 0%, #071312 55%)" },
  { id: "violet", label: "Violet Dusk", css: "radial-gradient(circle at 15% 85%, #2a1f4d 0%, #100b22 60%)" },
  { id: "ember", label: "Ember", css: "radial-gradient(circle at 85% 85%, #4a2410 0%, #170e08 60%)" },
  { id: "slate", label: "Slate", css: "linear-gradient(160deg, #1b2430 0%, #0d1218 100%)" },
  { id: "doodle", label: "Doodle Grid", css: "doodle" }, // special-cased: pattern, not a gradient
];

function presetById(id) {
  return WALLPAPER_PRESETS.find((p) => p.id === id);
}

export function getGlobalWallpaper() {
  return localStorage.getItem(DEFAULT_KEY) || "none";
}

export function setGlobalWallpaper(value) {
  if (value === "none") localStorage.removeItem(DEFAULT_KEY);
  else localStorage.setItem(DEFAULT_KEY, value);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function getChatWallpaper(conversationId) {
  return localStorage.getItem(PER_CHAT_PREFIX + conversationId) || "";
}

export function setChatWallpaper(conversationId, value) {
  if (!value || value === "inherit") localStorage.removeItem(PER_CHAT_PREFIX + conversationId);
  else localStorage.setItem(PER_CHAT_PREFIX + conversationId, value);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

// Resolves the *effective* wallpaper for a given chat (its own override, or
// else the global default) into inline style props ready to spread onto the
// message-list wrapper.
export function resolveWallpaperStyle(conversationId) {
  const value = (conversationId && getChatWallpaper(conversationId)) || getGlobalWallpaper();
  if (!value || value === "none") return {};

  if (value.startsWith("data:")) {
    return {
      backgroundImage: `linear-gradient(rgba(6,10,9,0.75), rgba(6,10,9,0.85)), url("${value}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }

  const preset = presetById(value);
  if (!preset) return {};
  if (preset.css === "doodle") {
    return {
      backgroundColor: "#0d1512",
      backgroundImage:
        "radial-gradient(circle, rgba(94,242,192,0.09) 1.5px, transparent 1.5px)",
      backgroundSize: "22px 22px",
    };
  }
  return { backgroundImage: preset.css };
}

export function onWallpaperChange(handler) {
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
