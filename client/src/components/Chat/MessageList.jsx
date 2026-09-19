import React, { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "../../context/ChatContext";
import { useAuth } from "../../context/AuthContext";
import MessageBubble from "./MessageBubble";
import TypingDots from "./TypingDots";
import { formatDayLabel } from "../../utils/time";
import { ChevronDownIcon } from "../common/Icons";

export default function MessageList({
  conversation,
  onReply,
  onEdit,
  searchQuery = "",
}) {
  const { messages, hasMore, loadMoreMessages, typing } = useChat();
  const { user } = useAuth();
  const typingUsers = Object.values(typing[conversation._id] || {});
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [highlightedId, setHighlightedId] = useState(null);
  const [virtualRange, setVirtualRange] = useState({ start: 0, end: 40 });
  const prevScrollHeight = useRef(0);
  const isFirstLoad = useRef(true);
  const shouldStickToBottomRef = useRef(true);
  const ROW_ESTIMATE = 94;
  const OVERSCAN = 12;

  const isNearBottom = (el, threshold = 220) =>
    el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;

  const updateVirtualRange = (el) => {
    if (!el || !displayedMessages.length) {
      setVirtualRange({ start: 0, end: 0 });
      return;
    }

    const scrollTop = el.scrollTop || 0;
    const viewportHeight = el.clientHeight || 0;
    const start = Math.max(0, Math.floor(scrollTop / ROW_ESTIMATE) - OVERSCAN);
    const end = Math.min(
      displayedMessages.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_ESTIMATE) + OVERSCAN
    );

    setVirtualRange({ start, end });
  };

  useEffect(() => {
    isFirstLoad.current = true;
    shouldStickToBottomRef.current = true;
  }, [conversation._id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (isFirstLoad.current) {
      el.scrollTop = el.scrollHeight;
      isFirstLoad.current = false;
      shouldStickToBottomRef.current = true;
      updateVirtualRange(el);
      return;
    }

    if (shouldStickToBottomRef.current && isNearBottom(el)) {
      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (!node) return;
        node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
      });
    }

    updateVirtualRange(el);
  }, [messages.length, typingUsers.length]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom <= 220;

    // Show scroll to bottom button if scrolled up > 250px
    setShowScrollBottom(distanceFromBottom > 250);
    updateVirtualRange(el);

    // Infinite scroll earlier messages
    if (loadingMore || !hasMore) return;
    if (el.scrollTop < 80) {
      setLoadingMore(true);
      prevScrollHeight.current = el.scrollHeight;
      const oldest = messages[0]?.createdAt;
      loadMoreMessages(oldest).then(() => {
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop =
              scrollRef.current.scrollHeight - prevScrollHeight.current;
          }
        });
        setLoadingMore(false);
      });
    }
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    shouldStickToBottomRef.current = true;
    setShowScrollBottom(false);
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  function handleJumpToMessage(msgId) {
    const targetEl = document.getElementById(`msg-${msgId}`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedId(msgId);
      setTimeout(() => setHighlightedId(null), 2000);
    }
  }

  const displayedMessages = useMemo(() => {
    if (!searchQuery?.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter(
      (m) =>
        m.text?.toLowerCase().includes(q) ||
        m.sender?.displayName?.toLowerCase().includes(q) ||
        m.attachments?.some((a) => a.name?.toLowerCase().includes(q))
    );
  }, [messages, searchQuery]);

  const visibleMessages = useMemo(() => {
    if (!displayedMessages.length) return [];
    const { start, end } = virtualRange;
    return displayedMessages.slice(start, end);
  }, [displayedMessages, virtualRange]);

  const totalVirtualHeight = displayedMessages.length * ROW_ESTIMATE;
  const topSpacerHeight = virtualRange.start * ROW_ESTIMATE;
  const bottomSpacerHeight = Math.max(0, displayedMessages.length - virtualRange.end) * ROW_ESTIMATE;

  let lastDay = null;
  if (virtualRange.start > 0) {
    for (let i = 0; i < virtualRange.start; i += 1) {
      lastDay = formatDayLabel(displayedMessages[i].createdAt);
    }
  }

  return (
    <div className="message-list-wrap">
      <div className="message-list" ref={scrollRef} onScroll={handleScroll}>
        {loadingMore && <div className="messages-loading">Loading earlier messages…</div>}

        {displayedMessages.length === 0 && searchQuery && (
          <div className="messages-empty-search">
            <p>No messages matching "{searchQuery}"</p>
          </div>
        )}

        <div className="message-list-inner" style={{ height: totalVirtualHeight }}>
          {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}

          {visibleMessages.map((msg, i) => {
            const actualIndex = virtualRange.start + i;
            const day = formatDayLabel(msg.createdAt);
            const showDay = day !== lastDay;
            lastDay = day;
            const prev = displayedMessages[actualIndex - 1];
            const isMine = (msg.sender?._id || msg.sender) === user._id;
            const grouped =
              !showDay &&
              prev &&
              (prev.sender?._id || prev.sender) === (msg.sender?._id || msg.sender) &&
              new Date(msg.createdAt) - new Date(prev.createdAt) < 3 * 60 * 1000;

            return (
              <div key={msg._id || msg.clientId || actualIndex}>
                {showDay && (
                  <div className="day-divider">
                    <span>{day}</span>
                  </div>
                )}
                <MessageBubble
                  message={msg}
                  isMine={isMine}
                  grouped={grouped}
                  isGroup={conversation.isGroup}
                  onReply={onReply}
                  onEdit={onEdit}
                  onJumpToMessage={handleJumpToMessage}
                  isHighlighted={highlightedId === msg._id}
                />
              </div>
            );
          })}

          {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
        </div>

        {typingUsers.length > 0 && (
          <div className="typing-bubble-row">
            <div className="typing-bubble">
              <TypingDots size="lg" />
              <span className="typing-bubble-text">
                {typingUsers.join(", ")} {typingUsers.length > 1 ? "are" : "is"} typing…
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {showScrollBottom && (
        <button
          className="scroll-bottom-btn"
          onClick={scrollToBottom}
          title="Scroll to latest messages"
        >
          <ChevronDownIcon size={18} />
        </button>
      )}
    </div>
  );
}
