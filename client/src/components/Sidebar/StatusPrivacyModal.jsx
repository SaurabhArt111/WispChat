import { useEffect, useMemo, useState } from "react";
import client from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import Modal from "../common/Modal";
import { CheckIcon } from "../common/Icons";
import "../../styles/status.css";

const MODES = [
  { id: "contacts", title: "My contacts", hint: "Share with all of your contacts" },
  { id: "contacts_except", title: "My contacts except…", hint: "Share with your contacts except people you select" },
  { id: "only_share_with", title: "Only share with…", hint: "Only share with selected contacts" },
];

// "Who can see my status updates" — same three choices as WhatsApp. The
// server enforces it (statusController.canViewStatus), so it applies to the
// feed and to direct status views alike.
export default function StatusPrivacyModal({ onClose }) {
  const { user, setUser } = useAuth();
  const { showToast } = useToast();
  const saved = user.statusPrivacy || {};
  const [mode, setMode] = useState(saved.mode || "contacts");
  const [except, setExcept] = useState(() => new Set((saved.exceptUsers || []).map(String)));
  const [only, setOnly] = useState(() => new Set((saved.onlyUsers || []).map(String)));
  const [contacts, setContacts] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    client
      .get("/users/contacts")
      .then((r) => active && setContacts(r.data.contacts || []))
      .catch(() => active && setContacts([]));
    return () => {
      active = false;
    };
  }, []);

  const picking = mode !== "contacts";
  const selected = mode === "contacts_except" ? except : only;
  const setSelected = mode === "contacts_except" ? setExcept : setOnly;

  function toggle(id) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  const canSave = useMemo(() => mode === "contacts" || mode === "contacts_except" || only.size > 0, [mode, only]);

  async function save() {
    setBusy(true);
    try {
      const res = await client.patch("/users/status-privacy", {
        mode,
        exceptUsers: [...except],
        onlyUsers: [...only],
      });
      setUser(res.data.user);
      showToast("Status privacy updated");
      onClose();
    } catch {
      showToast("Couldn't update status privacy", "danger");
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Status privacy"
      onClose={onClose}
      width={420}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !canSave}>Save</button>
        </>
      }
    >
      <p className="privacy-heading">Who can see my status updates</p>
      {MODES.map((m) => (
        <button key={m.id} className="privacy-option" onClick={() => setMode(m.id)}>
          <span className={`privacy-radio ${mode === m.id ? "on" : ""}`} />
          <span className="privacy-option-text">
            <strong>{m.title}</strong>
            <span>{m.hint}</span>
          </span>
        </button>
      ))}

      {picking && (
        <div className="privacy-picker">
          <p className="privacy-heading">
            {mode === "contacts_except" ? "Hide my status from" : "Share my status with"} ({selected.size})
          </p>
          {contacts === null ? (
            <p className="posts-empty">Loading contacts…</p>
          ) : contacts.length === 0 ? (
            <p className="posts-empty">You have no contacts yet.</p>
          ) : (
            <div className="privacy-contacts">
              {contacts.map((c) => (
                <button key={c._id} className="privacy-contact" onClick={() => toggle(String(c._id))}>
                  <Avatar user={c} size={34} />
                  <span>{c.displayName}</span>
                  {selected.has(String(c._id)) && <CheckIcon size={16} />}
                </button>
              ))}
            </div>
          )}
          {mode === "only_share_with" && only.size === 0 && (
            <p className="privacy-warn">Pick at least one contact.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
