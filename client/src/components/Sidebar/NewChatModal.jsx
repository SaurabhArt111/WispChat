import { useEffect, useState } from "react";
import client from "../../api/client";
import { useChat } from "../../context/ChatContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import Modal from "../common/Modal";
import { SearchIcon, UserPlusIcon, SendIcon } from "../common/Icons";

export default function NewChatModal({ onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [loading, setLoading] = useState(false);
  const { startDirectConversation, openConversation } = useChat();
  const { showToast } = useToast();

  useEffect(() => {
    client.get("/users/contacts").then((res) => setContacts(res.data.contacts || []));
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      client
        .get("/users/search", { params: { q } })
        .then((res) => setResults(res.data.users || []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  async function openChat(userId) {
    setBusyId(userId);
    try {
      const conv = await startDirectConversation(userId);
      await openConversation(conv._id);
      onClose();
    } catch (err) {
      showToast("Could not start conversation", "danger");
    } finally {
      setBusyId(null);
    }
  }

  async function addContact(userId) {
    setBusyId(userId);
    try {
      await client.post("/users/friend-requests", { userId });
      showToast("Friend request sent");
    } catch (err) {
      showToast(err?.response?.data?.message || "Couldn't send request", "danger");
    } finally {
      setBusyId(null);
    }
  }

  const contactIds = new Set(contacts.map((c) => c._id));
  const list = query.trim() ? results : contacts;

  return (
    <Modal title="New Conversation" onClose={onClose}>
      <div className="field">
        <div className="sidebar-search">
          <SearchIcon size={16} className="sidebar-search-icon" />
          <input
            placeholder="Search by name, @username or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      <div className="user-pick-list">
        {loading && <p className="modal-hint">Searching users…</p>}
        {!loading && list.length === 0 && (
          <p className="modal-hint">
            {query.trim()
              ? "No users found matching your search."
              : "No contacts yet. Type a username above to find people."}
          </p>
        )}
        {!loading &&
          list.map((u) => (
            <div key={u._id} className="user-pick-row">
              <Avatar user={u} size={42} showStatus online={u.isOnline} />
              <div className="user-pick-info">
                <div className="user-pick-name">{u.displayName}</div>
                <div className="user-pick-sub">@{u.username}</div>
              </div>
              {contactIds.has(u._id) || !query.trim() ? (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busyId === u._id}
                  onClick={() => openChat(u._id)}
                >
                  <SendIcon size={13} /> Chat
                </button>
              ) : (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busyId === u._id}
                  onClick={() => addContact(u._id)}
                >
                  <UserPlusIcon size={14} /> Add
                </button>
              )}
            </div>
          ))}
      </div>
    </Modal>
  );
}
