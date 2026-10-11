import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { useContextMenu } from "../../context/ContextMenuContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import ConversationItem from "./ConversationItem";
import NewChatModal from "./NewChatModal";
import NewGroupModal from "./NewGroupModal";
import FriendRequestsModal from "./FriendRequestsModal";
import PanelMenuButton from "./PanelMenuButton";
import client from "../../api/client";
import useLiveRefresh from "../../hooks/useLiveRefresh";
import {
  SearchIcon,
  CloseIcon,
  BellIcon,
  UsersIcon,
  UserPlusIcon,
  PlusIcon,
  NewChatIcon,
  EditIcon,
  SparklesIcon,
  ArchiveIcon,
  ArrowDownIcon,
  CheckIcon,
  SettingsIcon,
  ImageIcon,
} from "../common/Icons";
import "../../styles/sidebar.css";

// Telegram-style pull-down-to-archive. The pull has real resistance: you must
// drag the list down roughly 2x ROW_H before the bar flips from "Pull down for
// archive" to "Release for archive" — a casual scroll bounce never triggers it.
const ROW_H = 66; // px reserved above the list once the "Archived chats" row is revealed
const PILL_SPACE = ROW_H;
const PILL_REVEAL = 68; // list offset (after resistance) needed to arm the release
const COLLAPSE_AT = ROW_H * 0.5; // drag back up past this (while revealed) to hide it again
const PULL_MAX = 120;
const PULL_RESISTANCE = 0.5;
const REVEALED_KEY = "wisp_archive_row_revealed";

export default function Sidebar({ onOpenNewChat, onOpenNewGroup, onOpenArchived, onOpenProfile, onOpenSettings }) {
  const { user, logout } = useAuth();
  const { conversations, activeId, openConversation, loadingConversations, upsertConversation } = useChat();
  const { openMenu } = useContextMenu();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [requestCount, setRequestCount] = useState(0);
  // Whether the "Archived" pill is currently pinned above the list. Unlike
  // a momentary pull-to-refresh, this persists after the finger/mouse lets
  // go — it only goes away again once the person deliberately drags the
  // list back up (see pullEnd), or taps the pill to actually open Archived.
  const [revealed, setRevealedState] = useState(() => {
    try {
      return localStorage.getItem(REVEALED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setRevealed = (value) => {
    setRevealedState(value);
    try {
      localStorage.setItem(REVEALED_KEY, value ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  // Only non-null while a drag is actively in progress, so the list can
  // track the finger/mouse live; falls back to the resting position
  // (0 or PILL_SPACE, depending on `revealed`) the rest of the time.
  const [liveOffset, setLiveOffset] = useState(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);
  const dragRef = useRef(null);
  const pullStateRef = useRef(null);

  const archivedList = useMemo(() => conversations.filter((c) => c.archived), [conversations]);
  const archivedCount = archivedList.length;
  const archivedUnread = useMemo(
    () => archivedList.reduce((n, c) => n + (c.muted ? 0 : c.unreadCount || 0), 0),
    [archivedList]
  );
  // The row only makes sense while there is something archived.
  const rowShown = revealed && archivedCount > 0;
  const restingOffset = rowShown ? PILL_SPACE : 0;
  const armedRef = useRef(false);
  const displayOffset = liveOffset ?? restingOffset;
  pullStateRef.current = { revealed: rowShown, restingOffset, archivedCount };

  // Pulled far enough to reveal, or (when already revealed) not pulled back
  // up far enough to hide. Nothing to reveal when there are no archived chats.
  function decideReveal(isRevealed, offset) {
    if (isRevealed) return offset >= COLLAPSE_AT;
    return archivedCount > 0 && offset >= PILL_REVEAL;
  }

  // A small haptic tick when the pull crosses the "release to archive" line.
  useEffect(() => {
    if (liveOffset === null) return;
    const armed = !rowShown && liveOffset >= PILL_REVEAL;
    if (armed && !armedRef.current && navigator.vibrate) {
      try {
        navigator.vibrate(8);
      } catch {}
    }
    armedRef.current = armed;
  }, [liveOffset, rowShown]);

  // Pull-to-reveal-Archived, mirroring Telegram: dragging down from the
  // top of the list reveals a persistent "Archived" pill pinned above it —
  // it stays there (tapping it opens Archived) until the person drags the
  // list back up from the top far enough to collapse it again. Nothing
  // about the gesture itself opens Archived; only tapping the pill does.
  //
  // Pointer Events handle mouse and pen; touch uses native touch events so
  // ordinary vertical scrolling remains native until a pull engages.
  function pullStart(e) {
    if (e.pointerType === "touch") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (listRef.current?.scrollTop > 0) return;
    // Never start a pull from the row-swipe zone of a chat row that is
    // already open/being dragged horizontally.
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      lock: null, // "vertical" | "horizontal" once the direction is decided
      baseOffset: restingOffset,
      finalOffset: restingOffset,
      engaged: false,
      pointerId: e.pointerId,
      source: "pointer",
    };
  }
  function pullMove(e) {
    const drag = dragRef.current;
    if (!drag || drag.source !== "pointer" || drag.pointerId !== e.pointerId) return;
    const delta = e.clientY - drag.startY;
    // Direction lock: a gesture belongs to the row-swipe (horizontal) OR the
    // archive pull (vertical), never both. Without this a slightly diagonal
    // row swipe also dragged the "Release for archive" bar down.
    if (!drag.lock) {
      const dx = Math.abs(e.clientX - drag.startX);
      const dy = Math.abs(delta);
      if (dx < 8 && dy < 8) return;
      drag.lock = dy > dx * 1.6 ? "vertical" : "horizontal";
    }
    if (drag.lock === "horizontal") return;
    if (!drag.engaged) {
      if (Math.abs(delta) < 10) return;
      if (delta < 0 && !revealed) return; // nothing to collapse yet, let it scroll
      drag.engaged = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    e.preventDefault();
    const next = drag.baseOffset + delta * PULL_RESISTANCE;
    drag.finalOffset = Math.max(0, Math.min(PULL_MAX, next));
    setLiveOffset(drag.finalOffset);
  }
  function pullEnd(e) {
    const drag = dragRef.current;
    if (!drag || drag.source !== "pointer") return;
    if (drag.engaged) {
      setRevealed(decideReveal(rowShown, drag.finalOffset));
    }
    dragRef.current = null;
    armedRef.current = false;
    setLiveOffset(null);
    try {
      e?.currentTarget?.releasePointerCapture?.(e.pointerId);
    } catch {}
  }

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    function touchStart(e) {
      if (e.touches.length !== 1 || list.scrollTop > 0) return;
      const touch = e.touches[0];
      const { restingOffset: baseOffset } = pullStateRef.current;
      dragRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        lock: null,
        baseOffset,
        finalOffset: baseOffset,
        engaged: false,
        pointerId: touch.identifier,
        source: "touch",
      };
    }

    function touchMove(e) {
      const drag = dragRef.current;
      if (!drag || drag.source !== "touch") return;
      const touch = Array.from(e.touches).find((item) => item.identifier === drag.pointerId);
      if (!touch) return;
      const delta = touch.clientY - drag.startY;
      const { revealed: isRevealed } = pullStateRef.current;
      if (!drag.lock) {
        const dx = Math.abs(touch.clientX - drag.startX);
        const dy = Math.abs(delta);
        if (dx < 8 && dy < 8) return;
        drag.lock = dy > dx * 1.6 ? "vertical" : "horizontal";
      }
      if (drag.lock === "horizontal") return; // that's a chat-row swipe, not a pull
      if (!drag.engaged) {
        if (Math.abs(delta) < 10 || (delta < 0 && !isRevealed)) return;
        drag.engaged = true;
      }
      if (e.cancelable) e.preventDefault();
      drag.finalOffset = Math.max(0, Math.min(PULL_MAX, drag.baseOffset + delta * PULL_RESISTANCE));
      setLiveOffset(drag.finalOffset);
    }

    function touchEnd(e) {
      const drag = dragRef.current;
      if (!drag || drag.source !== "touch") return;
      const touchEnded = Array.from(e.changedTouches).some((item) => item.identifier === drag.pointerId);
      if (!touchEnded) return;
      if (drag.engaged) {
        const { revealed: isRevealed } = pullStateRef.current;
        // This effect only runs once, so read the *current* values via the
        // ref rather than the closure's first-render copies.
        setRevealed(
          isRevealed
            ? drag.finalOffset >= COLLAPSE_AT
            : pullStateRef.current.archivedCount > 0 && drag.finalOffset >= PILL_REVEAL
        );
      }
      dragRef.current = null;
      armedRef.current = false;
      setLiveOffset(null);
    }

    list.addEventListener("touchstart", touchStart, { passive: true });
    list.addEventListener("touchmove", touchMove, { passive: false });
    list.addEventListener("touchend", touchEnd, { passive: true });
    list.addEventListener("touchcancel", touchEnd, { passive: true });
    return () => {
      list.removeEventListener("touchstart", touchStart);
      list.removeEventListener("touchmove", touchMove);
      list.removeEventListener("touchend", touchEnd);
      list.removeEventListener("touchcancel", touchEnd);
    };
  }, []);

  const loadRequestCount = useCallback(
    () =>
      client
        .get("/users/friend-requests")
        .then((res) => setRequestCount(res.data.incoming?.length || 0))
        .catch(() => {}),
    []
  );
  useEffect(() => {
    loadRequestCount();
  }, [loadRequestCount]);
  // New / accepted / declined requests update the badge live.
  useLiveRefresh(loadRequestCount, {
    events: ["friend-request:new", "friend-request:resolved", "friend-request:changed", "contacts:changed"],
    pollMs: 90000,
  });

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

  // This page's own menu (each page has its own — see PanelMenuButton).
  const chatsMenuItems = [
    { label: "New chat", icon: <NewChatIcon size={15} />, onClick: () => (onOpenNewChat ? onOpenNewChat() : setShowNewChat(true)) },
    { label: "New group", icon: <UsersIcon size={15} />, onClick: () => (onOpenNewGroup ? onOpenNewGroup() : setShowNewGroup(true)) },
    { label: "Friend requests" + (requestCount ? ` (${requestCount})` : ""), icon: <BellIcon size={15} />, onClick: () => setShowRequests(true) },
    { divider: true },
    { label: "Groups", icon: <UsersIcon size={15} />, onClick: () => navigate("/groups") },
    { label: "Media & storage", icon: <ImageIcon size={15} />, onClick: () => navigate("/media") },
    { label: "Broadcast lists", icon: <BellIcon size={15} />, onClick: () => navigate("/broadcast") },
    { label: archivedCount ? `Archived chats (${archivedCount})` : "Archived chats", icon: <ArchiveIcon size={15} />, onClick: onOpenArchived },
    unreadTotal > 0 && { label: "Mark all as read", icon: <CheckIcon size={15} />, onClick: markAllRead },
    { divider: true },
    { label: "Settings", icon: <SettingsIcon size={15} />, onClick: onOpenSettings },
  ];

  async function markAllRead() {
    const unread = conversations.filter((c) => (c.unreadCount || 0) > 0);
    unread.forEach((c) => upsertConversation({ _id: c._id, unreadCount: 0 }));
    await Promise.allSettled(unread.map((c) => client.post(`/messages/${c._id}/read`)));
    showToast?.(`Marked ${unread.length} chat${unread.length === 1 ? "" : "s"} as read`);
  }

  function openSelfMenu(e) {
    openMenu(
      e,
      [
        {
          label: "Profile & settings",
          icon: <EditIcon size={15} />,
          onClick: onOpenProfile,
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
            className="icon-btn primary-icon-btn new-chat-topbtn"
            title="New conversation"
            onClick={() => (onOpenNewChat ? onOpenNewChat() : setShowNewChat(true))}
          >
            <PlusIcon size={18} />
          </button>
          <PanelMenuButton title="Chats menu" items={chatsMenuItems} />
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

      <div className="conversation-list-wrap">
        {displayOffset > 2 && (
          <div
            className={`archive-pull ${rowShown && !dragRef.current?.engaged ? "pinned" : ""} ${
              displayOffset >= (rowShown ? COLLAPSE_AT : PILL_REVEAL) ? "ready" : ""
            }`}
            style={{
              height: displayOffset,
              transition: dragRef.current?.engaged ? "none" : "height 260ms cubic-bezier(.2,.8,.2,1)",
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {rowShown && !dragRef.current?.engaged ? (
              <button className="archived-row" onClick={onOpenArchived}>
                <span className="archived-row-icon">
                  <ArchiveIcon size={22} />
                </span>
                <span className="archived-row-main">
                  <span className="archived-row-title">Archived chats</span>
                  <span className="archived-row-sub">
                    {archivedList
                      .slice(0, 3)
                      .map((c) => (c.isGroup ? c.name : c.participants?.find((p) => p._id !== user._id)?.displayName) || "Chat")
                      .join(", ")}
                  </span>
                </span>
                <span className="archived-row-meta">
                  {archivedUnread > 0 && <span className="unread-badge muted">{archivedUnread}</span>}
                  {/* <span className="archived-row-count">{archivedCount}</span> */}
                </span>
              </button>
            ) : (
              <div className="archive-pull-bar" aria-live="polite">
                <span
                  className="archive-pull-arrow"
                  style={{ transform: `rotate(${displayOffset >= (rowShown ? COLLAPSE_AT : PILL_REVEAL) ? 180 : Math.min(180, (displayOffset / PILL_REVEAL) * 180)}deg)` }}
                >
                  <ArrowDownIcon size={18} />
                </span>
                <span className="archive-pull-text">
                  {rowShown
                    ? displayOffset >= COLLAPSE_AT
                      ? "Archived chats"
                      : "Release to hide archive"
                    : archivedCount === 0
                    ? "No archived chats"
                    : displayOffset >= PILL_REVEAL
                    ? "Release for archive"
                    : "Pull down for archive"}
                </span>
              </div>
            )}
          </div>
        )}
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
      </div>

      {/* Floating "new chat" button — phones only (the topbar + is hidden there) */}
      <button
        className="new-chat-fab"
        title="New chat"
        aria-label="New chat"
        onClick={() => (onOpenNewChat ? onOpenNewChat() : setShowNewChat(true))}
      >
        <NewChatIcon size={26} />
      </button>

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
      {showRequests && (
        <FriendRequestsModal
          onClose={() => setShowRequests(false)}
          onCountChange={setRequestCount}
        />
      )}
    </aside>
  );
}
