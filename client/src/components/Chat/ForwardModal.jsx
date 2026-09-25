import { useState } from "react";
import { useChat } from "../../context/ChatContext";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useDecryptedText } from "../../hooks/useDecryptedMessage";
import Avatar from "../common/Avatar";
import Modal from "../common/Modal";
import { ForwardIcon } from "../common/Icons";

export default function ForwardModal({ message, onClose }) {
  const { conversations, forwardMessage } = useChat();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const { text: snippetText, locked } = useDecryptedText(message);

  function toggle(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function handleForward() {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      await forwardMessage(message, selected);
      showToast(`Message forwarded to ${selected.length} conversation${selected.length > 1 ? "s" : ""}`);
      onClose();
    } catch (err) {
      showToast(err?.message || "Could not forward message", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Forward Message"
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary"
          disabled={selected.length === 0 || busy}
          onClick={handleForward}
        >
          <ForwardIcon size={16} />
          {busy ? "Sending…" : `Forward (${selected.length})`}
        </button>
      }
    >
      <div className="forward-message-snippet">
        <span className="snippet-label">Message to forward:</span>
        <div className="snippet-body">
          {locked
            ? "🔒 Encrypted message"
            : snippetText || (message.attachments?.length ? "📎 Media attachment" : "Message")}
        </div>
      </div>

      <div className="user-pick-list">
        {conversations.length === 0 && (
          <p className="modal-hint">No active conversations to forward to.</p>
        )}
        {conversations.map((c) => {
          const other = !c.isGroup ? c.participants?.find((p) => p._id !== user._id) : null;
          const label = c.isGroup ? c.name : other?.displayName || "Unknown";
          const avatarUser = c.isGroup
            ? { displayName: c.name, avatar: c.avatar, avatarColor: "#64748b" }
            : other;

          return (
            <label key={c._id} className="user-pick-row selectable">
              <input
                type="checkbox"
                checked={selected.includes(c._id)}
                onChange={() => toggle(c._id)}
              />
              <Avatar user={avatarUser} size={40} showStatus={!c.isGroup} online={other?.isOnline} />
              <div className="user-pick-info">
                <div className="user-pick-name">{label}</div>
                <div className="user-pick-sub">
                  {c.isGroup ? `${c.participants?.length || 0} members` : `@${other?.username || ""}`}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </Modal>
  );
}
