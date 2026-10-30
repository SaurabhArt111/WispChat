import { useCallback, useEffect, useState } from "react";
import { useToast } from "../../context/ToastContext";
import { native, isNative } from "../../native/wispNative";
import { backupChats } from "../../native/backup";
import { isAutoSaveOn, setAutoSave } from "../../native/nativeMedia";
import { registerPush } from "../../native/push";

const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/**
 * Settings → General, Android app only: what makes notifications / ringing
 * reliable, and where WispChat keeps its files on the phone.
 */
export default function NativeSettingsSection() {
  const { showToast } = useToast();
  const [status, setStatus] = useState(null);
  const [storage, setStorage] = useState(null);
  const [backups, setBackups] = useState([]);
  const [busy, setBusy] = useState("");
  const [autoSave, setAuto] = useState(isAutoSaveOn());

  const refresh = useCallback(async () => {
    setStatus(await native.getNotificationStatus());
    setStorage(await native.getStorageInfo());
    setBackups(await native.listFiles("Backups"));
  }, []);

  useEffect(() => {
    if (isNative) refresh();
  }, [refresh]);

  if (!isNative) return null;

  async function enableNotifications() {
    const s = await native.requestNotificationPermission();
    if (!s?.granted) native.openSettings("notifications"); // already denied once: only Settings can change it
    await registerPush();
    refresh();
  }

  async function runBackup() {
    setBusy("backup");
    try {
      const r = await backupChats();
      showToast(`Backed up ${r.chats} chats (${r.messages} messages) to WispChat/Backups`);
      refresh();
    } catch (e) {
      showToast(e?.message || "Backup failed", "danger");
    } finally {
      setBusy("");
    }
  }

  const folders = (storage?.folders || []).filter((f) => f.files > 0);
  const total = (storage?.folders || []).reduce((n, f) => n + f.bytes, 0);

  return (
    <>
      <div className="settings-section-title" style={{ marginTop: 20 }}>Notifications &amp; calls</div>
      <div className="settings-kv">
        <span>Message notifications</span>
        <strong>{status ? (status.granted ? "On" : "Off") : "…"}</strong>
      </div>
      <div className="settings-kv">
        <span>Incoming-call screen over the lock screen</span>
        <strong>{status ? (status.fullScreenIntent ? "Allowed" : "Not allowed") : "…"}</strong>
      </div>
      <div className="settings-kv">
        <span>Battery optimisation</span>
        <strong>{status ? (status.ignoringBatteryOptimizations ? "Unrestricted" : "Default") : "…"}</strong>
      </div>
      <p className="settings-hint">
        For calls to ring reliably when the app is closed, allow notifications and the full-screen call screen. On some
        phones (Xiaomi, Oppo, Vivo, Samsung…) also set battery usage for WispChat to “Unrestricted”.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {status && !status.granted && (
          <button className="btn btn-primary btn-sm" onClick={enableNotifications}>Turn on notifications</button>
        )}
        {status && !status.fullScreenIntent && (
          <button className="btn btn-ghost btn-sm" onClick={() => native.openSettings("fullscreen")}>Allow call screen</button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => native.openSettings("battery")}>Battery settings</button>
      </div>

      <div className="settings-section-title" style={{ marginTop: 20 }}>Storage on this phone</div>
      <div className="settings-kv">
        <span>Folder</span>
        <strong style={{ wordBreak: "break-all", textAlign: "right" }}>
          {storage?.root ? storage.root.replace(/^\/storage\/emulated\/0/, "Internal storage") : "…"}
        </strong>
      </div>
      {folders.map((f) => (
        <div className="settings-kv" key={f.name}>
          <span>{f.name}</span>
          <strong>{f.files} · {fmtBytes(f.bytes)}</strong>
        </div>
      ))}
      {storage && (
        <div className="settings-kv">
          <span>Total</span>
          <strong>{fmtBytes(total)}</strong>
        </div>
      )}
      <label className="settings-toggle-row" style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 12, cursor: "pointer" }}>
        <span>Save photos, videos and audio to the folder automatically</span>
        <input
          type="checkbox"
          checked={autoSave}
          onChange={(e) => {
            setAutoSave(e.target.checked);
            setAuto(e.target.checked);
          }}
        />
      </label>

      <div className="settings-section-title" style={{ marginTop: 20 }}>Back up chats</div>
      <p className="settings-hint">
        Saves your chats and call history as a file in WispChat/Backups. Encrypted messages stay encrypted in the backup.
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={runBackup} disabled={!!busy}>
          {busy === "backup" ? "Backing up…" : "Back up now"}
        </button>
      </div>
      {backups.slice(0, 3).map((b) => (
        <div className="settings-kv" key={b.name}>
          <span style={{ wordBreak: "break-all" }}>{b.name}</span>
          <strong>{fmtBytes(b.bytes)}</strong>
        </div>
      ))}
    </>
  );
}
