import { useMemo } from "react";
import { useChat } from "../../context/ChatContext";
import ConversationItem from "./ConversationItem";
import { ArchiveIcon, BackIcon } from "../common/Icons";
import "../../styles/railPanels.css";

export default function ArchivedPanel({ onBack }) {
  const { conversations, activeId, openConversation } = useChat();
  const archived = useMemo(() => conversations.filter((c) => c.archived), [conversations]);

  return (
    <aside className="rail-panel">
      <div className="rail-panel-header">
        {onBack && (
          <button className="icon-btn btn-sm" onClick={onBack} title="Back">
            <BackIcon size={18} />
          </button>
        )}
        <h2>Archived</h2>
        <span className="rail-panel-count">{archived.length}</span>
      </div>
      {archived.length === 0 ? (
        <div className="rail-panel-empty">
          <ArchiveIcon size={30} />
          <p>No archived chats. Right-click any chat and choose "Archive chat" to tuck it away here.</p>
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
