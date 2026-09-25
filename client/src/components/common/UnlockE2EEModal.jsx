import { useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../context/AuthContext";
import { LockIcon } from "./Icons";
import "../../styles/e2ee.css";

/**
 * Shown once per fresh page load whenever the account has (or needs) an
 * encryption keypair but the private key isn't unlocked in memory yet —
 * i.e. right after a refresh. Re-entering the password derives the same
 * unwrap key locally and never leaves the browser.
 */
export default function UnlockE2EEModal() {
  const { user, logout, e2ee } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!user || (!e2ee.needsUnlock && !e2ee.needsSetup)) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    const ok = await e2ee.unlock(password);
    setBusy(false);
    if (!ok) setError("That password didn't unlock your encrypted chats. Try again.");
    else setPassword("");
  }

  return createPortal(
    <div className="e2ee-unlock-overlay">
      <div className="e2ee-unlock-card">
        <div className="e2ee-unlock-icon">
          <LockIcon size={28} />
        </div>
        <h2>{e2ee.needsSetup ? "Set up secure chats" : "Unlock your secure chats"}</h2>
        <p>
          {e2ee.needsSetup
            ? "Wisp encrypts your messages end-to-end. Enter your password once to turn it on for this account — it's tied to your account, so it'll work on any device you log into."
            : "This browser hasn't unlocked your encrypted chats yet. Enter your password once — it'll be remembered on this browser from now on, so you won't see this again unless you log out."}
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            autoFocus
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div className="e2ee-unlock-error">{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={busy || !password}>
            {busy ? "Unlocking…" : e2ee.needsSetup ? "Turn on encryption" : "Unlock"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Log out instead
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}
