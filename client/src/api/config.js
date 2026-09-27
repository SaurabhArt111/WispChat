const backendOrigin = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");
const localBackendOrigin = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?=\/|$)/i;

export const apiBaseUrl = `${backendOrigin}/api`;
export const socketUrl = backendOrigin || undefined;

export function mediaUrl(url) {
  if (!url || /^(data:|blob:)/i.test(url)) return url;

  let normalizedUrl = url.trim();
  while (/^https?:\/\/https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = normalizedUrl.replace(/^https?:\/\//i, "");
  }

  if (backendOrigin && localBackendOrigin.test(normalizedUrl)) {
    return normalizedUrl.replace(localBackendOrigin, backendOrigin);
  }
  if (/^https?:\/\//i.test(normalizedUrl) || !backendOrigin) return normalizedUrl;
  return `${backendOrigin}${normalizedUrl.startsWith("/") ? "" : "/"}${normalizedUrl}`;
}