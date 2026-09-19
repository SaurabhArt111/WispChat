import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { useContextMenu } from "../../context/ContextMenuContext";
import Avatar from "../common/Avatar";
import LiquidGlassPanel from "../common/LiquidGlassPanel";
import ConversationItem from "./ConversationItem";
import NewChatModal from "./NewChatModal";
import NewGroupModal from "./NewGroupModal";
import ProfileModal from "./ProfileModal";
import FriendRequestsModal from "./FriendRequestsModal";
import client from "../../api/client";
import {
  SearchIcon,
  CloseIcon,
  BellIcon,
  UsersIcon,
  UserPlusIcon,
  PlusIcon,
  EditIcon,
  SparklesIcon,
} from "../common/Icons";
import "../../styles/sidebar.css";

export default function Sidebar({ onOpenNewChat, onOpenNewGroup }) {
  const { user, logout } = useAuth();
  const { conversations, activeId, openConversation, loadingConversations } = useChat();
  const { openMenu } = useContextMenu();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [requestCount, setRequestCount] = useState(0);
  const searchInputRef = useRef(null);

  useEffect(() => {
    client
      .get("/users/friend-requests")
      .then((res) => setRequestCount(res.data.incoming?.length || 0))
      .catch(() => {});
  }, []);

  // Keyboard shortcut '/' to focus search
  useEffect(() => {
    function onKeyDown(e) {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const unreadTotal = useMemo(() => {
    return conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
  }, [conversations]);

  const filtered = useMemo(() => {
    let list = conversations.filter((c) => !c.archived);
    if (filter === "groups") list = list.filter((c) => c.isGroup);
    if (filter === "direct") list = list.filter((c) => !c.isGroup);
    if (filter === "unread") list = list.filter((c) => (c.unreadCount || 0) > 0);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((c) => {
        const label = c.isGroup
          ? c.name
          : c.participants?.find((p) => p._id !== user._id)?.displayName || "";
        const username = c.isGroup
          ? ""
          : c.participants?.find((p) => p._id !== user._id)?.username || "";
        return label.toLowerCase().includes(q) || username.toLowerCase().includes(q);
      });
    }
    return list;
  }, [conversations, filter, query, user._id]);

  const pinnedList = useMemo(() => filtered.filter((c) => c.pinned), [filtered]);
  const regularList = useMemo(() => filtered.filter((c) => !c.pinned), [filtered]);

  function openSelfMenu(e) {
    openMenu(
      e,
      [
        {
          label: "Profile & settings",
          icon: <EditIcon size={15} />,
          onClick: () => setShowProfile(true),
        },
        {
          label: "Friend requests" + (requestCount ? ` (${requestCount})` : ""),
          icon: <BellIcon size={15} />,
          onClick: () => setShowRequests(true),
        },
        { divider: true },
        { label: "Log out", danger: true, onClick: logout },
      ],
      user.displayName
    );
  }

  return (
    <aside className="sidebar">
      <LiquidGlassPanel
        className="sidebar-topbar-lg"
        panelClassName="sidebar-topbar"
        config={{ blurAmount: 0.28, refraction: 0.3, edgeHighlight: 0.2, saturation: 0.1 }}
      >
        <button className="sidebar-self" onClick={openSelfMenu} title="Your Profile & Settings">
          <Avatar user={user} size={38} showStatus online />
        </button>
        <div className="sidebar-brand">
          <span className="sidebar-title">Wisp</span>
          <span className="sidebar-badge">chat</span>
        </div>
        <div className="sidebar-actions">
          <button
            className="icon-btn"
            title="Friend requests"
            onClick={() => setShowRequests(true)}
          >
            <BellIcon size={18} />
            {requestCount > 0 && <span className="badge-dot" />}
          </button>
          <button
            className="icon-btn"
            title="New group"
            onClick={() => (onOpenNewGroup ? onOpenNewGroup() : setShowNewGroup(true))}
          >
            <UsersIcon size={18} />
          </button>
          <button
            className="icon-btn primary-icon-btn"
            title="New conversation"
            onClick={() => (onOpenNewChat ? onOpenNewChat() : setShowNewChat(true))}
          >
            <PlusIcon size={18} />
          </button>
        </div>
      </LiquidGlassPanel>

      <div className="sidebar-search-wrap">
        <div className="sidebar-search">
          <SearchIcon size={16} className="sidebar-search-icon" />
          <input
            ref={searchInputRef}
            placeholder="Search conversations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button className="sidebar-search-clear" onClick={() => setQuery("")} title="Clear">
              <CloseIcon size={14} />
            </button>
          ) : (
            <span className="sidebar-search-kbd">/</span>
          )}
        </div>
      </div>

      <div className="sidebar-filters">
        <button
          className={filter === "all" ? "active" : ""}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        <button
          className={filter === "unread" ? "active" : ""}
          onClick={() => setFilter("unread")}
        >
          Unread {unreadTotal > 0 && <span className="filter-pill-badge">{unreadTotal}</span>}
        </button>
        <button
          className={filter === "direct" ? "active" : ""}
          onClick={() => setFilter("direct")}
        >
          Direct
        </button>
        <button
          className={filter === "groups" ? "active" : ""}
          onClick={() => setFilter("groups")}
        >
          Groups
        </button>
      </div>

      <div className="conversation-list">
        {loadingConversations && (
          <div className="sidebar-skeletons">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="conv-item skeleton-row">
                <div className="skeleton skeleton-avatar" />
                <div className="conv-item-main">
                  <div className="skeleton skeleton-text w-60" />
                  <div className="skeleton skeleton-text w-80" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loadingConversations && filtered.length === 0 && (
          <div className="sidebar-empty">
            <div className="empty-chat-icon">💬</div>
            <p>{query ? "No chats found matching your search." : "No conversations yet."}</p>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => (onOpenNewChat ? onOpenNewChat() : setShowNewChat(true))}
            >
              <PlusIcon size={14} /> Start a conversation
            </button>
          </div>
        )}

        {/* Pinned section */}
        {pinnedList.length > 0 && (
          <div className="conv-group">
            <div className="conv-group-label">PINNED CHATS</div>
            {pinnedList.map((conv) => (
              <ConversationItem
                key={conv._id}
                conversation={conv}
                active={conv._id === activeId}
                onClick={() => openConversation(conv._id)}
              />
            ))}
          </div>
        )}

        {/* Regular section */}
        {regularList.length > 0 && (
          <div className="conv-group">
            {pinnedList.length > 0 && <div className="conv-group-label">ALL MESSAGES</div>}
            {regularList.map((conv) => (
              <ConversationItem
                key={conv._id}
                conversation={conv}
                active={conv._id === activeId}
                onClick={() => openConversation(conv._id)}
              />
            ))}
          </div>
        )}
      </div>

      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} />}
      {showNewGroup && <NewGroupModal onClose={() => setShowNewGroup(false)} />}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {showRequests && (
        <FriendRequestsModal
          onClose={() => setShowRequests(false)}
          onCountChange={setRequestCount}
        />
      )}
    </aside>
  );
}
