import { useMemo, useState } from "react";
import { useChat } from "../../context/ChatContext";
import { useToast } from "../../context/ToastContext";
import Modal from "../common/Modal";
import { CheckIcon, FolderIcon } from "../common/Icons";

// "Add to folder" from the chat long-press menu. Folders are just per-user
// labels on a conversation: pick one that already exists on another of your
// chats, type a new name, or clear the current one.
export default function AddToFolderSheet({ conversation, onClose }) {
  const { conversations, setConversationFolder } = useChat();
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const folders = useMemo(
    () => [...new Set(conversations.map((c) => c.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [conversations]
  );

  async function apply(folder) {
    if (busy) return;
    setBusy(true);
    try {
      await setConversationFolder(conversation._id, folder);
      showToast(folder ? `Added to "${folder}"` : "Removed from folder");
      onClose();
    } catch {
      showToast("Couldn't update folder", "danger");
      setBusy(false);
    }
  }

  function submitNew(e) {
    e.preventDefault();
    const v = name.trim();
    if (v) apply(v);
  }

  return (
    <Modal title="Add to folder" onClose={onClose} width={380}>
      <div className="folder-sheet">
        {folders.map((f) => (
          <button key={f} className="folder-row" onClick={() => apply(f)} disabled={busy}>
            <FolderIcon size={18} />
            <span>{f}</span>
            {conversation.folder === f && <CheckIcon size={16} />}
          </button>
        ))}
        <form className="folder-new" onSubmit={submitNew}>
          <input
            className="input"
            placeholder="New folder name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={!name.trim() || busy}>
            Create
          </button>
        </form>
        {conversation.folder && (
          <button className="btn btn-ghost btn-sm" onClick={() => apply("")} disabled={busy}>
            Remove from "{conversation.folder}"
          </button>
        )}
      </div>
    </Modal>
  );
}
