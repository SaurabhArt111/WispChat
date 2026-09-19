import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import client from "../../api/client";
import Avatar from "../common/Avatar";
import Modal from "../common/Modal";
import { useToast } from "../../context/ToastContext";
import { TrashIcon, UsersIcon } from "../common/Icons";

export default function GroupInfoModal({ conversation, onClose }) {
  const { user } = useAuth();
  const { upsertConversation } = useChat();
  const { showToast } = useToast();
  const [name, setName] = useState(conversation.name || "");
  const [description, setDescription] = useState(conversation.description || "");
  const [busy, setBusy] = useState(false);
  const isAdmin = conversation.admins?.some((a) => (a._id || a) === user._id);

  async function save() {
    setBusy(true);
    try {
      const res = await client.patch(`/conversations/group/${conversation._id}`, {
        name: name.trim(),
        description: description.trim(),
      });
      upsertConversation(res.data.conversation);
      showToast("Group details saved");
      onClose();
    } catch (err) {
      showToast("Could not update group", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(memberId) {
    try {
      const res = await client.patch(`/conversations/group/${conversation._id}/members`, {
        remove: [memberId],
      });
      upsertConversation(res.data.conversation);
      showToast("Member removed");
    } catch (err) {
      showToast("Could not remove member", "danger");
    }
  }

  return (
    <Modal
      title="Group Information"
      onClose={onClose}
      footer={
        isAdmin && (
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        )
      }
    >
      <div className="profile-avatar-row">
        <Avatar
          user={{
            displayName: conversation.name,
            avatar: conversation.avatar,
            avatarColor: "#64748b",
          }}
          size={64}
        />
        <div>
          <h3 style={{ margin: "0 0 4px", fontSize: "16px", color: "var(--text)" }}>
            {conversation.name}
          </h3>
          <span style={{ fontSize: "12.5px", color: "var(--text-faint)" }}>
            {conversation.participants?.length || 0} participants
          </span>
        </div>
      </div>

      <div className="field">
        <label>Group name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!isAdmin}
          maxLength={60}
        />
      </div>

      <div className="field">
        <label>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={!isAdmin}
          maxLength={200}
          rows={2}
          placeholder="Group topic or rules…"
        />
      </div>

      <div className="fr-heading">
        <span>Participants ({conversation.participants?.length || 0})</span>
      </div>

      <div className="user-pick-list">
        {conversation.participants?.map((p) => {
          const isParticipantAdmin = conversation.admins?.some(
            (a) => (a._id || a) === p._id
          );
          return (
            <div key={p._id} className="user-pick-row">
              <Avatar user={p} size={38} showStatus online={p.isOnline} />
              <div className="user-pick-info">
                <div className="user-pick-name">
                  {p.displayName} {p._id === user._id && <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>(You)</span>}
                  {isParticipantAdmin && <span className="admin-tag"> · Admin</span>}
                </div>
                <div className="user-pick-sub">@{p.username}</div>
              </div>
              {isAdmin && p._id !== user._id && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => removeMember(p._id)}
                  title="Remove from group"
                >
                  <TrashIcon size={14} /> Remove
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
