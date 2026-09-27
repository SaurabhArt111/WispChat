import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { useContextMenu } from "../../context/ContextMenuContext";
import Avatar from "../common/Avatar";
import ConversationItem from "./ConversationItem";
import NewChatModal from "./NewChatModal";
import NewGroupModal from "./NewGroupModal";
import ProfileModal from "./ProfileModal";
import FriendRequestsModal from "./FriendRequestsModal";
import MobileMoreButton from "./MobileMoreButton";
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
  ArchiveIcon,
} from "../common/Icons";
import "../../styles/sidebar.css";

const PILL_SPACE = 52; // px reserved above the list once the Archived pill is revealed/pinned
const PILL_REVEAL = 26; // px of downward drag needed to reveal it
const COLLAPSE_AT = PILL_SPACE * 0.5; // drag back up past this (while revealed) to hide it again
const PULL_MAX = 90;

export default function Sidebar({ onOpenNewChat, onOpenNewGroup, onOpenArchived, onOpenMore }) {
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
  // Whether the "Archived" pill is currently pinned above the list. Unlike
  // a momentary pull-to-refresh, this persists after the finger/mouse lets
  // go — it only goes away again once the person deliberately drags the
  // list back up (see pullEnd), or taps the pill to actually open Archived.
  const [revealed, setRevealed] = useState(false);
  // Only non-null while a drag is actively in progress, so the list can
  // track the finger/mouse live; falls back to the resting position
  // (0 or PILL_SPACE, depending on `revealed`) the rest of the time.
  const [liveOffset, setLiveOffset] = useState(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);
  const dragRef = useRef(null);

  const archivedCount = useMemo(() => conversations.filter((c) => c.archived).length, [conversations]);
  const restingOffset = revealed ? PILL_SPACE : 0;
  const displayOffset = liveOffset ?? restingOffset;

  // Pull-to-reveal-Archived, mirroring Telegram: dragging down from the
  // top of the list reveals a persistent "Archived" pill pinned above it —
  // it stays there (tapping it opens Archived) until the person drags the
  // list back up from the top far enough to collapse it again. Nothing
  // about the gesture itself opens Archived; only tapping the pill does.
  //
  // Built on Pointer Events (not separate touch/mouse handlers) so mouse,
  // touch and pen all go through one code path, and pointer capture keeps
  // receiving move/up events even if the finger drifts off the list. The
  // gesture only ever engages while the list is scrolled to the very top,
  // and once it does we suppress the browser's own scroll/overscroll for
  // that pointer so our transform doesn't fight native rubber-banding.
  function pullStart(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (listRef.current?.scrollTop > 0) return;
    dragRef.current = { startY: e.clientY, baseOffset: restingOffset, engaged: false, pointerId: e.pointerId };
  }
  function pullMove(e) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const delta = e.clientY - drag.startY;
    // Ignore upward drags entirely if the list can still scroll up itself;
    // only a genuine pull *past* the top should engage the reveal gesture,
    // so a small dead-zone keeps ordinary scroll flicks from misfiring it.
    if (!drag.engaged) {
      if (Math.abs(delta) < 6) return;
      if (delta < 0 && !revealed) return; // nothing to collapse yet, let it scroll
      drag.engaged = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    e.preventDefault();
    const next = drag.baseOffset + delta * 0.6;
    setLiveOffset(Math.max(0, Math.min(PULL_MAX, next)));
  }
  function pullEnd(e) {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.engaged) {
      const finalOffset = liveOffset ?? drag.baseOffset;
      setRevealed(revealed ? finalOffset >= COLLAPSE_AT : finalOffset >= PILL_REVEAL);
    }
    dragRef.current = null;
    setLiveOffset(null);
    try {
      e?.currentTarget?.releasePointerCapture?.(e.pointerId);
    } catch {}
  }

  useEffect(() => {
    client
      .get("/users/friend-requests")
      .then((res) => setRequestCount(res.data.incoming?.length || 0))
      .catch(() => {});
  }, []);

  // Keyboard shortcuts for search:
  //  - '/' focuses search, but only when not already typing somewhere else.
  //  - Ctrl/Cmd+F always focuses the conversation list search — even while
  //    a chat is open and its composer has focus — instead of letting the
  //    browser's own page-find UI take over.
  //  - Esc while the search input is focused blurs it and hands focus back
  //    to the app (e.g. back to the open chat) rather than doing nothing.
  useEffect(() => {
    function onKeyDown(e) {
      const isCtrlF = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f";
      if (isCtrlF) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && document.activeElement === searchInputRef.current) {
        searchInputRef.current.blur();
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
      <div className="sidebar-topbar">
        <button className="sidebar-self" onClick={openSelfMenu} title="Your Profile & Settings">
          <Avatar user={user} size={38} showStatus online />
        </button>
        <div className="sidebar-brand">
          <span className="sidebar-title">Wisp</span>
          <span className="sidebar-badge">chat</span>
        </div>
        <div className="sidebar-actions">
          {onOpenMore && <MobileMoreButton onClick={onOpenMore} />}
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
      </div>

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

      <div
        className="conversation-list"
        ref={listRef}
        onPointerDown={pullStart}
        onPointerMove={pullMove}
        onPointerUp={pullEnd}
        onPointerCancel={pullEnd}
        style={{
          transform: displayOffset ? `translateY(${displayOffset}px)` : undefined,
          transition: dragRef.current?.engaged ? "none" : "transform 220ms var(--ease)",
          touchAction: "pan-y",
        }}
      >
        {displayOffset > PILL_REVEAL * 0.6 && (
          <button
            className={`archived-pull-pill entering ${revealed && !dragRef.current?.engaged ? "pinned" : ""} ${
              displayOffset >= (revealed ? COLLAPSE_AT : PILL_REVEAL) ? "ready" : ""
            }`}
            style={{
              top: -displayOffset,
              opacity: Math.min(1, displayOffset / PILL_REVEAL),
              transition: dragRef.current?.engaged ? "none" : "top 220ms var(--ease), opacity 160ms var(--ease)",
            }}
            onClick={onOpenArchived}
          >
            <ArchiveIcon size={15} />
            Archived{archivedCount ? ` (${archivedCount})` : ""}
          </button>
        )}
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

      {showNewChat && (
        <NewChatModal
          onClose={() => setShowNewChat(false)}
          onOpenNewGroup={() => {
            setShowNewChat(false);
            onOpenNewGroup ? onOpenNewGroup() : setShowNewGroup(true);
          }}
        />
      )}
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
