// Express 4 does not catch rejected promises from async route handlers. Without
// this, ONE failed database call inside any controller becomes an
// "unhandledRejection", which terminates the Node process on Node >= 15: every
// connected phone drops, the host restarts the server, and the app looks like
// "chat not loading / backend not connected".
//
// This patches Express's Layer once so a rejected async handler is passed to
// next(err) (-> the JSON error handler in server.js) instead of crashing.
import Layer from "express/lib/router/layer.js";

let patched = false;
export function installAsyncErrorHandling() {
  if (patched) return;
  patched = true;
  const original = Layer.prototype.handle_request;
  Layer.prototype.handle_request = function handle(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next(); // error-handling middleware: leave alone
    try {
      const out = fn(req, res, next);
      if (out && typeof out.then === "function") out.catch(next);
    } catch (err) {
      next(err);
    }
  };
  Layer.prototype.handle_request.__original = original;
}
