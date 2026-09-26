import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import client from "../../api/client";
import Avatar from "../common/Avatar";
import Modal from "../common/Modal";
import AvatarCropModal from "../Sidebar/AvatarCropModal";
import { useToast } from "../../context/ToastContext";
import { TrashIcon, CameraIcon, ShieldIcon, UserPlusIcon, CloseIcon } from "../common/Icons";

export default function GroupInfoModal({ conversation, onClose }) {
  const { user } = useAuth();
  const { upsertConversation } = useChat();
  const { showToast } = useToast();
  const [name, setName] = useState(conversation.name || "");
  const [description, setDescription] = useState(conversation.description || "");
  const [busy, setBusy] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const isAdmin = conversation.admins?.some((a) => (a._id || a) === user._id);
  const adminCount = conversation.admins?.length || 0;

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

  async function saveIcon(dataUrl) {
    setCropFile(null);
    try {
      const res = await client.patch(`/conversations/group/${conversation._id}`, { avatar: dataUrl });
      upsertConversation(res.data.conversation);
      showToast("Group icon updated");
    } catch {
      showToast("Could not update group icon", "danger");
    }
  }

  async function toggleAnnouncementMode() {
    try {
      const res = await client.patch(`/conversations/group/${conversation._id}`, {
        onlyAdminsCanMessage: !conversation.onlyAdminsCanMessage,
      });
      upsertConversation(res.data.conversation);
    } catch {
      showToast("Could not update setting", "danger");
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

  async function promote(memberId) {
    try {
      const res = await client.patch(`/conversations/group/${conversation._id}/admins`, {
        promote: [memberId],
      });
      upsertConversation(res.data.conversation);
      showToast("Made group admin");
    } catch (err) {
      showToast(err?.response?.data?.message || "Could not promote member", "danger");
    }
  }

  async function demote(memberId) {
    try {
      const res = await client.patch(`/conversations/group/${conversation._id}/admins`, {
        demote: [memberId],
      });
      upsertConversation(res.data.conversation);
      showToast("Removed as admin");
    } catch (err) {
      showToast(err?.response?.data?.message || "Could not demote member", "danger");
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
        <div className={isAdmin ? "group-icon-upload" : ""}>
          <Avatar
            user={{
              displayName: conversation.name,
              avatar: conversation.avatar,
              avatarColor: "#64748b",
            }}
            size={64}
          />
          {isAdmin && (
            <>
              <span className="group-icon-upload-badge">
                <CameraIcon size={13} />
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) setCropFile(file);
                }}
              />
            </>
          )}
        </div>
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

      {isAdmin && (
        <label className="preference-toggle-row compact">
          <input
            type="checkbox"
            checked={!!conversation.onlyAdminsCanMessage}
            onChange={toggleAnnouncementMode}
          />
          <div>
            <div className="preference-title">Only admins can send messages</div>
            <div className="preference-desc">
              Everyone can still read and react — turn this on for announcement-style groups.
            </div>
          </div>
        </label>
      )}

      <div className="fr-heading" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Participants ({conversation.participants?.length || 0})</span>
        {isAdmin && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAddMembers(true)}>
            <UserPlusIcon size={14} /> Add
          </button>
        )}
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
                  {isParticipantAdmin && (
                    <span className="admin-tag">
                      {" "}
                      · <ShieldIcon size={11} /> Admin
                    </span>
                  )}
                </div>
                <div className="user-pick-sub">@{p.username}</div>
              </div>
              {isAdmin && p._id !== user._id && (
                <div className="user-pick-row-actions">
                  {isParticipantAdmin ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => demote(p._id)}
                      disabled={adminCount <= 1}
                      title={adminCount <= 1 ? "Promote someone else first" : "Remove as admin"}
                    >
                      Dismiss as admin
                    </button>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => promote(p._id)}>
                      Make admin
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => removeMember(p._id)}
                    title="Remove from group"
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {cropFile && (
        <AvatarCropModal file={cropFile} onCancel={() => setCropFile(null)} onSave={saveIcon} />
      )}

      {showAddMembers && (
        <AddMembersModal
          conversation={conversation}
          onClose={() => setShowAddMembers(false)}
          onAdded={(conv) => {
            upsertConversation(conv);
            setShowAddMembers(false);
          }}
        />
      )}
    </Modal>
  );
}

function AddMembersModal({ conversation, onClose, onAdded }) {
  const { showToast } = useToast();
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const existingIds = new Set((conversation.participants || []).map((p) => p._id));

  useEffect(() => {
    client.get("/users/contacts").then((res) => setContacts(res.data.contacts || []));
  }, []);

  const available = contacts.filter((c) => !existingIds.has(c._id));

  function toggle(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function handleAdd() {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      const res = await client.patch(`/conversations/group/${conversation._id}/members`, {
        add: selected,
      });
      onAdded(res.data.conversation);
      showToast("Members added");
    } catch {
      showToast("Could not add members", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add members"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={busy || selected.length === 0} onClick={handleAdd}>
          {busy ? "Adding…" : `Add (${selected.length})`}
        </button>
      }
    >
      {selected.length > 0 && (
        <div className="selected-chips-wrap">
          {available
            .filter((c) => selected.includes(c._id))
            .map((u) => (
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
        {available.length === 0 && <p className="modal-hint">All your contacts are already in this group.</p>}
        {available.map((u) => (
          <label key={u._id} className="user-pick-row selectable">
            <input type="checkbox" checked={selected.includes(u._id)} onChange={() => toggle(u._id)} />
            <Avatar user={u} size={38} showStatus online={u.isOnline} />
            <div className="user-pick-info">
              <div className="user-pick-name">{u.displayName}</div>
              <div className="user-pick-sub">@{u.username}</div>
            </div>
          </label>
        ))}
      </div>
    </Modal>
  );
}
