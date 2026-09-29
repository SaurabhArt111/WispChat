import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { useChat } from "../../context/ChatContext";
import { useAuth } from "../../context/AuthContext";
import MessageBubble from "./MessageBubble";
import TypingDots from "./TypingDots";
import { formatDayLabel } from "../../utils/time";
import { ChevronDownIcon, LockIcon } from "../common/Icons";
import { onWallpaperChange, resolveWallpaperStyle } from "../../utils/wallpaper";

// react-virtuoso's "inverse infinite scroll" needs a large positive starting
// offset that can keep shrinking as older pages are prepended.
const START_INDEX = 1_000_000;

export default function MessageList({ conversation, onReply, onEdit, searchQuery = "" }) {
  const chat = useChat();
  const { messages, hasMore, loadMoreMessages, typing } = chat;
  const { user } = useAuth();
  const typingUsers = Object.values(typing[conversation._id] || {});
  const virtuosoRef = useRef(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [highlightedId, setHighlightedId] = useState(null);
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  const [wallpaperStyle, setWallpaperStyle] = useState(() => resolveWallpaperStyle(conversation._id));
  const prevFirstKeyRef = useRef(null);
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const loadingMoreRef = useRef(false);
  const [floatingDay, setFloatingDay] = useState(null);
  const [scrolling, setScrolling] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const atBottomRef = useRef(true);
  const scrollIdleRef = useRef(null);

  // MessageBubble is React.memo'd, so everything handed to it must keep a
  // stable identity between renders. The parent's callbacks (and the chat
  // actions) change identity constantly, so bubbles get thin wrappers that
  // always call the *latest* version through a ref.
  const latest = useRef({});
  latest.current = { onReply, onEdit, chat };
  const stable = useMemo(
    () => ({
      onReply: (...a) => latest.current.onReply?.(...a),
      onEdit: (...a) => latest.current.onEdit?.(...a),
      reactToMessage: (...a) => latest.current.chat.reactToMessage(...a),
      requestDeleteMessage: (...a) => latest.current.chat.requestDeleteMessage(...a),
      undoDeleteMessage: (...a) => latest.current.chat.undoDeleteMessage(...a),
    }),
    []
  );

  // Re-resolve the wallpaper whenever it changes (Settings → Chats default,
  // or this chat's own "More → Chat wallpaper" override).
  useEffect(() => {
    setWallpaperStyle(resolveWallpaperStyle(conversation._id));
    return onWallpaperChange(() => setWallpaperStyle(resolveWallpaperStyle(conversation._id)));
  }, [conversation._id]);

  const displayedMessages = useMemo(() => {
    if (!searchQuery?.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter(
      (m) =>
        (!m.encrypted && m.text?.toLowerCase().includes(q)) ||
        m.sender?.displayName?.toLowerCase().includes(q) ||
        m.attachments?.some((a) => a.name?.toLowerCase().includes(q))
    );
  }, [messages, searchQuery]);

  // Virtualized with react-virtuoso, which measures every row's *real*
  // height (ResizeObserver) instead of a fixed estimate. That is what the
  // old hand-rolled virtualization got wrong — text bubbles, photo grids
  // and videos differ wildly in height, so fixed estimates made the scroll
  // position jump and rows vanish. Day dividers / grouping are precomputed
  // per row so itemContent doesn't need neighbour lookups.
  const rows = useMemo(() => {
    let lastDay = null;
    return displayedMessages.map((msg, i) => {
      const day = formatDayLabel(msg.createdAt);
      const showDay = day !== lastDay;
      lastDay = day;
      const prev = displayedMessages[i - 1];
      const isMine = (msg.sender?._id || msg.sender) === user._id;
      const grouped =
        !showDay &&
        prev &&
        (prev.sender?._id || prev.sender) === (msg.sender?._id || msg.sender) &&
        new Date(msg.createdAt) - new Date(prev.createdAt) < 3 * 60 * 1000;
      return { key: msg._id || msg.clientId || i, msg, day, showDay, isMine, grouped };
    });
  }, [displayedMessages, user._id]);

  // Keeps scroll position steady when older history is prepended: lowering
  // firstItemIndex by the number of prepended rows keeps every visible row's
  // effective index unchanged. Detected via the previous first row's key (not
  // array length) so edits/reactions/appends don't trigger it. A layout
  // effect applies it before paint, so there's no visible jump.
  useLayoutEffect(() => {
    const newFirstKey = rows[0]?.key ?? null;
    const prevKey = prevFirstKeyRef.current;
    if (prevKey != null && newFirstKey != null && prevKey !== newFirstKey) {
      const prependedCount = rows.findIndex((r) => r.key === prevKey);
      if (prependedCount > 0) setFirstItemIndex((v) => v - prependedCount);
    }
    prevFirstKeyRef.current = newFirstKey;
  }, [rows]);

  // Latest 60 load first (server default); every time the person scrolls to
  // the top, the next 60 older messages are fetched.
  function handleStartReached() {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const oldest = messages[0]?.createdAt;
    Promise.resolve(loadMoreMessages(oldest)).finally(() => {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    });
  }

  function scrollToBottom() {
    setShowScrollBottom(false);
    setNewCount(0);
    virtuosoRef.current?.scrollToIndex({
      index: firstItemIndex + rows.length - 1,
      align: "end",
      behavior: "smooth",
    });
  }

  // Works even when the target row isn't mounted (virtualized out). Kept
  // identity-stable (reads rows/firstItemIndex through a ref) so it doesn't
  // defeat MessageBubble's memo.
  const jumpState = useRef({});
  jumpState.current = { rows, firstItemIndex };
  const handleJumpToMessage = useCallback((msgId) => {
    const { rows: r, firstItemIndex: first } = jumpState.current;
    const idx = r.findIndex((x) => x.msg._id === msgId);
    if (idx < 0) return;
    virtuosoRef.current?.scrollToIndex({ index: first + idx, align: "center", behavior: "smooth" });
    setHighlightedId(msgId);
    setTimeout(() => setHighlightedId(null), 2000);
  }, []);

  // Count messages that arrive while the person is scrolled up, so the
  // "jump to latest" button can say how many they've missed.
  const lastKey = rows[rows.length - 1]?.key;
  const lastMine = rows[rows.length - 1]?.isMine;
  const prevLastKeyRef = useRef(lastKey);
  useEffect(() => {
    if (prevLastKeyRef.current !== lastKey && lastKey != null && !atBottomRef.current && !lastMine) {
      setNewCount((c) => c + 1);
    }
    prevLastKeyRef.current = lastKey;
  }, [lastKey, lastMine]);

  // Floating date pill (like WhatsApp): shows the day of the topmost visible
  // message while scrolling, then fades out shortly after scrolling stops.
  function handleScroll({ currentTarget }) {
    const boundary = currentTarget.getBoundingClientRect().top + 34;
    let crossedDivider = null;
    currentTarget.querySelectorAll(".day-divider").forEach((divider) => {
      if (divider.getBoundingClientRect().top <= boundary) crossedDivider = divider;
    });

    const crossedDay = crossedDivider?.querySelector("span")?.textContent;
    if (crossedDay) {
      setFloatingDay((day) => (day === crossedDay ? day : crossedDay));
      return;
    }

    const activeRow = Array.from(currentTarget.querySelectorAll(".message-row-item")).find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.top <= boundary && rect.bottom > boundary;
    });
    const activeDay = activeRow?.dataset.day;
    if (activeDay) setFloatingDay((day) => (day === activeDay ? day : activeDay));
  }
  function handleIsScrolling(isScrolling) {
    clearTimeout(scrollIdleRef.current);
    if (isScrolling) setScrolling(true);
    else scrollIdleRef.current = setTimeout(() => setScrolling(false), 900);
  }
  useEffect(() => () => clearTimeout(scrollIdleRef.current), []);

  const showEmptySearch = searchQuery && rows.length === 0;
  const typingKey = typingUsers.join(", ");

  const components = useMemo(
    () => ({
      Header: () => (
        <div className="chat-gutter">
          {loadingMore ? (
          <div className="messages-loading">Loading earlier messages…</div>
        ) : !searchQuery && !hasMore && rows.length > 0 ? (
          <div className="e2ee-intro-banner">
            <LockIcon size={13} />
            <span>
              Messages and calls in this chat are end-to-end encrypted. Only people in this chat
              can read, listen to, or share them.
            </span>
          </div>
        ) : (
          <div style={{ height: 8 }} />
        )}
        </div>
      ),
      Footer: () => (
        <div className="chat-gutter chat-footer">
        {typingKey ? (
          <div className="typing-bubble-row">
            <div className="typing-bubble">
              <TypingDots size="lg" />
              <span className="typing-bubble-text">
                {typingKey} {typingUsers.length > 1 ? "are" : "is"} typing…
              </span>
            </div>
          </div>
        ) : (
          <div style={{ height: 8 }} />
        )}
        </div>
      ),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadingMore, hasMore, searchQuery, rows.length > 0, typingKey]
  );

  return (
    <div className="message-list-wrap" style={wallpaperStyle}>
      {showEmptySearch ? (
        <div className="message-list">
          <div className="messages-empty-search">
            <p>No messages matching "{searchQuery}"</p>
          </div>
        </div>
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          className="message-list"
          data={rows}
          computeItemKey={(index, row) => row.key}
          firstItemIndex={firstItemIndex}
          initialTopMostItemIndex={
            rows.length ? { index: rows.length - 1, align: "end" } : undefined
          }
          alignToBottom
          followOutput={(isAtBottom) => (isAtBottom ? "smooth" : false)}
          atBottomThreshold={220}
          atBottomStateChange={(atBottom) => {
            atBottomRef.current = atBottom;
            setShowScrollBottom(!atBottom);
            if (atBottom) setNewCount(0);
          }}
          startReached={handleStartReached}
          onScroll={handleScroll}
          isScrolling={handleIsScrolling}
          // A close estimate of a typical bubble keeps the first layout pass
          // near the truth (less correction/jump), and a moderate overscan
          // keeps the number of live bubbles — each of which may be decrypting
          // media — small.
          defaultItemHeight={76}
          increaseViewportBy={{ top: 500, bottom: 300 }}
          components={components}
          itemContent={(index, row) => (
            <div className="message-row-item" data-day={row.day}>
              {row.showDay && (
                <div className="day-divider">
                  <span>{row.day}</span>
                </div>
              )}
              <MessageBubble
                message={row.msg}
                isMine={row.isMine}
                grouped={row.grouped}
                isGroup={conversation.isGroup}
                onReply={stable.onReply}
                onEdit={stable.onEdit}
                onJumpToMessage={handleJumpToMessage}
                isHighlighted={highlightedId === row.msg._id}
                userId={user._id}
                reactToMessage={stable.reactToMessage}
                requestDeleteMessage={stable.requestDeleteMessage}
                undoDeleteMessage={stable.undoDeleteMessage}
              />
            </div>
          )}
        />
      )}

      {floatingDay && (
        <div className={`floating-day ${scrolling && !showEmptySearch ? "visible" : ""}`}>
          <span>{floatingDay}</span>
        </div>
      )}

      {showScrollBottom && (
        <button className="scroll-bottom-btn" onClick={scrollToBottom} title="Scroll to latest messages">
          <ChevronDownIcon size={18} />
          {newCount > 0 && <span className="scroll-bottom-badge">{newCount > 99 ? "99+" : newCount}</span>}
        </button>
      )}
    </div>
  );
}
