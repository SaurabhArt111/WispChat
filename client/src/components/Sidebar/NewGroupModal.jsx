import { useEffect, useState } from "react";
import client from "../../api/client";
import { useChat } from "../../context/ChatContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import Modal from "../common/Modal";
import { UsersIcon, BackIcon, CloseIcon } from "../common/Icons";

export default function NewGroupModal({ onClose }) {
  const [step, setStep] = useState(1);
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const { createGroup, openConversation } = useChat();
  const { showToast } = useToast();

  useEffect(() => {
    client.get("/users/contacts").then((res) => setContacts(res.data.contacts || []));
  }, []);

  function toggle(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const conv = await createGroup(name.trim(), selected, description.trim());
      await openConversation(conv._id);
      showToast("Group created successfully");
      onClose();
    } catch (err) {
      showToast(err?.response?.data?.message || "Couldn't create group", "danger");
    } finally {
      setBusy(false);
    }
  }

  const selectedUsers = contacts.filter((c) => selected.includes(c._id));

  return (
    <Modal
      title={step === 1 ? "New Group · Select Members" : "Group Details"}
      onClose={onClose}
      footer={
        step === 1 ? (
          <button
            className="btn btn-primary"
            disabled={selected.length < 1}
            onClick={() => setStep(2)}
          >
            Next ({selected.length})
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={() => setStep(1)}>
              <BackIcon size={16} /> Back
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !name.trim()}
              onClick={handleCreate}
            >
              {busy ? "Creating…" : "Create Group"}
            </button>
          </>
        )
      }
    >
      {step === 1 ? (
        <div className="new-group-step">
          {selectedUsers.length > 0 && (
            <div className="selected-chips-wrap">
              {selectedUsers.map((u) => (
                <span key={u._id} className="selected-chip">
                  <span>{u.displayName}</span>
                  <button type="button" onClick={() => toggle(u._id)}>
                    <CloseIcon size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="user-pick-list">
            {contacts.length === 0 && (
              <p className="modal-hint">Add some contacts first to create a group.</p>
            )}
            {contacts.map((u) => (
              <label key={u._id} className="user-pick-row selectable">
                <input
                  type="checkbox"
                  checked={selected.includes(u._id)}
                  onChange={() => toggle(u._id)}
                />
                <Avatar user={u} size={40} showStatus online={u.isOnline} />
                <div className="user-pick-info">
                  <div className="user-pick-name">{u.displayName}</div>
                  <div className="user-pick-sub">@{u.username}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      ) : (
        <div className="new-group-step-2">
          <div className="field">
            <label>Group Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="e.g. Project Launch, Weekend Trip"
              maxLength={60}
            />
          </div>
          <div className="field">
            <label>Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this group about?"
              rows={2}
              maxLength={200}
            />
          </div>
          <div className="selected-summary">
            <UsersIcon size={16} />
            <span>
              {selected.length} member{selected.length > 1 ? "s" : ""} selected
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}
