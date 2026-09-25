/**
 * A thin wrapper around console logging that avoids dumping raw error
 * objects — which, for a failed API call, often include the full request
 * config (auth headers, request body) and the backend's response body —
 * into the browser console where anyone with devtools open can read them.
 *
 * Use `logError(context, err)` anywhere code currently does
 * `console.error("...", err)`. In development it still prints a short,
 * useful line (context + status + message) so debugging isn't harder;
 * it just never prints `err.response.data`, `err.config`, or the error
 * object itself wholesale.
 */

const isDev = import.meta.env.DEV;

export function summarizeError(err) {
  if (!err) return "Unknown error";
  if (err.response) {
    // Axios error: surface only the HTTP status + a short message, never
    // the raw response body (which may itself contain other users' data,
    // stack traces, etc. depending on what the endpoint returned).
    const status = err.response.status;
    const msg = typeof err.response.data?.message === "string" ? err.response.data.message : err.message;
    return `[${status}] ${msg}`;
  }
  return err.message || String(err);
}

export function logError(context, err) {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.error(`[${context}]`, summarizeError(err));
  }
  // In production, intentionally silent — a user-facing toast (already
  // shown by the calling code) is the right surface for them, and the
  // console shouldn't be a second, unsanitized copy of the same failure.
}
