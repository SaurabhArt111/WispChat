import { useEffect, useRef, useState } from "react";
import client from "../api/client";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  SparklesIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  AlertIcon,
  LockIcon,
} from "../components/common/Icons";
import "../styles/auth.css";

export default function AuthPage() {
  const [mode, setMode] = useState("login");
  const { login, register, googleLogin, finishGoogleEncryption, sessionNotice, clearSessionNotice } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    identifier: "",
    username: "",
    displayName: "",
    email: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // ---- Google sign-in (Google Identity Services) ----
  const [googleClientId, setGoogleClientId] = useState(null);
  const [googleStep, setGoogleStep] = useState(null); // { stage, token, user, isNewUser }
  const [passcode, setPasscode] = useState("");
  const [passcode2, setPasscode2] = useState("");
  const googleBtnRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    client
      .get("/auth/config")
      .then((res) => !cancelled && setGoogleClientId(res.data.googleClientId || null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!googleClientId || googleStep) return undefined;
    let cancelled = false;

    function init() {
      if (cancelled || !window.google?.accounts?.id || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          setError("");
          setBusy(true);
          try {
            setGoogleStep(await googleLogin(credential));
          } catch (err) {
            setError(err?.response?.data?.message || err?.message || "Google sign-in failed.");
          } finally {
            setBusy(false);
          }
        },
        ux_mode: "popup",
      });
      googleBtnRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: "filled_black",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width: Math.min(340, googleBtnRef.current.clientWidth || 340),
      });
    }

    if (window.google?.accounts?.id) init();
    else {
      let script = document.getElementById("google-gsi");
      if (!script) {
        script = document.createElement("script");
        script.id = "google-gsi";
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", init);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId, googleStep, mode]);

  async function handlePasscodeSubmit(e) {
    e.preventDefault();
    setError("");
    if (googleStep.stage === "setup") {
      if (passcode.length < 6) return setError("Use at least 6 characters.");
      if (passcode !== passcode2) return setError("The two passcodes don't match.");
    }
    setBusy(true);
    try {
      await finishGoogleEncryption(googleStep, passcode);
      navigate("/");
    } catch (err) {
      setError(err?.message || "Couldn't unlock your chats.");
    } finally {
      setBusy(false);
    }
  }

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(form.identifier, form.password);
      } else {
        await register({
          username: form.username,
          displayName: form.displayName,
          email: form.email,
          password: form.password,
        });
      }
      navigate("/");
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Something went wrong. Please check your details.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <div className="auth-brand-glow" />
        <div className="auth-brand-badge">
          <SparklesIcon size={20} />
          <span>Real-time Messenger</span>
        </div>
        <div className="auth-brand-mark">wisp</div>
        <p className="auth-brand-tag">
          A quieter, faster place to communicate. Real-time delivery, instant media composition, and rich canvas drawing tools.
        </p>
        <ul className="auth-brand-points">
          <li>
            <CheckIcon size={14} className="point-icon" />
            <span>Instant Socket.io delivery &amp; glowing read receipts</span>
          </li>
          <li>
            <CheckIcon size={14} className="point-icon" />
            <span>Drag, drop or paste screenshots straight into any chat</span>
          </li>
          <li>
            <CheckIcon size={14} className="point-icon" />
            <span>Pre-send canvas drawing, crop &amp; rotation image studio</span>
          </li>
          <li>
            <CheckIcon size={14} className="point-icon" />
            <span>Group chats, emoji reactions, edit history &amp; custom menus</span>
          </li>
        </ul>
      </div>

      <div className="auth-panel">
        <div className="auth-card">
          <div className="auth-tabs">
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={mode === "register" ? "active" : ""}
              onClick={() => {
                setMode("register");
                setError("");
              }}
            >
              Create Account
            </button>
          </div>

          {googleStep ? (
            <form className="auth-form google-passcode" onSubmit={handlePasscodeSubmit}>
              <div className="google-passcode-head">
                <LockIcon size={18} />
                <strong>
                  {googleStep.stage === "setup" ? "Create your encryption passcode" : "Enter your encryption passcode"}
                </strong>
              </div>
              <p className="auth-hint">
                {googleStep.stage === "setup"
                  ? `Signed in as ${googleStep.user.email}. Your chats are end-to-end encrypted, so only you hold the key. Choose a passcode to protect it — you'll enter it once on each new device. We can't recover it for you.`
                  : `Signed in as ${googleStep.user.email}. Enter the encryption passcode you chose to unlock your chats on this device.`}
              </p>
              <div className="field">
                <label>Passcode</label>
                <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoFocus required minLength={6} autoComplete={googleStep.stage === "setup" ? "new-password" : "current-password"} />
              </div>
              {googleStep.stage === "setup" && (
                <div className="field">
                  <label>Confirm passcode</label>
                  <input type="password" value={passcode2} onChange={(e) => setPasscode2(e.target.value)} required minLength={6} autoComplete="new-password" />
                </div>
              )}
              {error && (
                <div className="field-error">
                  <AlertIcon size={14} />
                  <span>{error}</span>
                </div>
              )}
              <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
                {busy ? "Please wait…" : googleStep.stage === "setup" ? "Turn on encryption" : "Unlock"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => { setGoogleStep(null); setPasscode(""); setPasscode2(""); setError(""); }}>
                Use a different account
              </button>
            </form>
          ) : (
          <>
          {sessionNotice && (
            <div className="auth-notice" role="status">
              <LockIcon size={15} />
              <span>{sessionNotice}</span>
            </div>
          )}

          <form onSubmit={(e) => { clearSessionNotice(); handleSubmit(e); }} className="auth-form">
            {mode === "login" ? (
              <div className="field">
                <label>Username or email</label>
                <input
                  value={form.identifier}
                  onChange={update("identifier")}
                  placeholder="alex or alex@example.com"
                  autoFocus
                  required
                />
              </div>
            ) : (
              <>
                <div className="field-row">
                  <div className="field">
                    <label>Display name</label>
                    <input
                      value={form.displayName}
                      onChange={update("displayName")}
                      placeholder="Alex Mercer"
                      autoFocus
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Username</label>
                    <input
                      value={form.username}
                      onChange={update("username")}
                      placeholder="alex_m"
                      pattern="[a-zA-Z0-9_.]+"
                      title="Letters, numbers, underscore and dot only"
                      required
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Email address</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={update("email")}
                    placeholder="alex@example.com"
                    required
                  />
                </div>
              </>
            )}

            <div className="field">
              <label>Password</label>
              <div className="password-input-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={update("password")}
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword((s) => !s)}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="field-error">
                <AlertIcon size={14} />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
              {busy ? "Please wait…" : mode === "login" ? "Sign In to Wisp" : "Create Account"}
            </button>
          </form>

          {googleClientId && (
            <div className="auth-google">
              <div className="auth-or"><span>or</span></div>
              <div ref={googleBtnRef} className="auth-google-btn" />
            </div>
          )}

          <p className="auth-switch">
            {mode === "login" ? (
              <>
                New to Wisp?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("register");
                    setError("");
                  }}
                  className="link-btn"
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already registered?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError("");
                  }}
                  className="link-btn"
                >
                  Sign in here
                </button>
              </>
            )}
          </p>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
