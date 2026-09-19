import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  SparklesIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  AlertIcon,
} from "../components/common/Icons";
import "../styles/auth.css";

export default function AuthPage() {
  const [mode, setMode] = useState("login");
  const { login, register } = useAuth();
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
      setError(err?.response?.data?.message || "Something went wrong. Please check your details.");
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

          <form onSubmit={handleSubmit} className="auth-form">
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
        </div>
      </div>
    </div>
  );
}
