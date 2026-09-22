const backendOrigin = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");

export const apiBaseUrl = `${backendOrigin}/api`;
export const socketUrl = backendOrigin || undefined;

export function mediaUrl(url) {
  if (!url || !backendOrigin || /^(data:|blob:|https?:\/\/)/i.test(url)) return url;
  return `${backendOrigin}${url.startsWith("/") ? "" : "/"}${url}`;
}