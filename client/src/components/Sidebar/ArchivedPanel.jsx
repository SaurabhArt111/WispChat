import { useMemo } from "react";
import { useChat } from "../../context/ChatContext";
import ConversationItem from "./ConversationItem";
import PanelMenuButton from "./PanelMenuButton";
import { ArchiveIcon, BackIcon, SettingsIcon, CheckIcon } from "../common/Icons";
import client from "../../api/client";
import { useToast } from "../../context/ToastContext";
import "../../styles/railPanels.css";

export default function ArchivedPanel({ onBack, onOpenSettings }) {
  const { conversations, activeId, openConversation, upsertConversation } = useChat();
  const { showToast } = useToast();
  const archived = useMemo(() => conversations.filter((c) => c.archived), [conversations]);

  async function unarchiveAll() {
    const ids = archived.map((c) => c._id);
    ids.forEach((id) => upsertConversation({ _id: id, archived: false }));
    await Promise.allSettled(ids.map((id) => client.post(`/conversations/${id}/flag`, { flag: "archive", value: false })));
    showToast(`Unarchived ${ids.length} chat${ids.length === 1 ? "" : "s"}`);
    onBack?.();
  }

  const menuItems = [
    archived.length > 0 && { label: "Unarchive all", icon: <ArchiveIcon size={15} />, onClick: unarchiveAll },
    { label: "Back to chats", icon: <BackIcon size={15} />, onClick: onBack },
    { divider: true },
    { label: "Settings", icon: <SettingsIcon size={15} />, onClick: onOpenSettings },
  ];

  return (
    <aside className="rail-panel archived-panel">
      <div className="rail-panel-header">
        {onBack && (
          <button className="icon-btn btn-sm" onClick={onBack} title="Back">
            <BackIcon size={18} />
          </button>
        )}
        <h2>Archived</h2>
        <span className="rail-panel-count">{archived.length}</span>
        <PanelMenuButton title="Archived menu" items={menuItems} />
      </div>
      {archived.length === 0 ? (
        <div className="rail-panel-empty">
          <ArchiveIcon size={30} />
          <p>No archived chats. Swipe a chat left (or long-press it) and choose Archive to tuck it away here.</p>
        </div>
      ) : (
        <div className="rail-panel-list">
          {archived.map((conv) => (
            <ConversationItem
              key={conv._id}
              conversation={conv}
              active={conv._id === activeId}
              onClick={() => openConversation(conv._id)}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
