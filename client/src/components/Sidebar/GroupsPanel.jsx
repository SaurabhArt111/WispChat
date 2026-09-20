import { useMemo, useState } from "react";
import { useChat } from "../../context/ChatContext";
import ConversationItem from "./ConversationItem";
import NewGroupModal from "./NewGroupModal";
import { UsersIcon, PlusIcon } from "../common/Icons";
import "../../styles/railPanels.css";

export default function GroupsPanel() {
  const { conversations, activeId, openConversation } = useChat();
  const [showNewGroup, setShowNewGroup] = useState(false);
  const groups = useMemo(
    () => conversations.filter((c) => c.isGroup && !c.archived),
    [conversations]
  );

  return (
    <aside className="rail-panel">
      <div className="rail-panel-header">
        <h2>Groups</h2>
        <button className="icon-btn" title="Create group" onClick={() => setShowNewGroup(true)}>
          <PlusIcon size={17} />
        </button>
      </div>
      {groups.length === 0 ? (
        <div className="rail-panel-empty">
          <UsersIcon size={30} />
          <p>No groups yet.</p>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNewGroup(true)}>
            <PlusIcon size={14} /> Create a group
          </button>
        </div>
      ) : (
        <div className="rail-panel-list">
          {groups.map((conv) => (
            <ConversationItem
              key={conv._id}
              conversation={conv}
              active={conv._id === activeId}
              onClick={() => openConversation(conv._id)}
            />
          ))}
        </div>
      )}
      {showNewGroup && <NewGroupModal onClose={() => setShowNewGroup(false)} />}
    </aside>
  );
}
