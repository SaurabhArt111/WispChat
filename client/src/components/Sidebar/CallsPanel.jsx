import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Virtuoso } from "react-virtuoso";
import client from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { useCall } from "../../context/CallContext";
import { useSocket } from "../../context/SocketContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import PanelMenuButton from "./PanelMenuButton";
import {
  PhoneIcon,
  VideoIcon,
  SearchIcon,
  CloseIcon,
  RefreshIcon,
  SettingsIcon,
  StarFilledIcon,
  StarIcon,
  PhoneIncomingIcon,
  PhoneOutgoingIcon,
} from "../common/Icons";
import { formatListTime } from "../../utils/time";
import useLiveRefresh from "../../hooks/useLiveRefresh";
import "../../styles/railPanels.css";

// First paint only needs one screenful; older logs stream in on scroll.
const PAGE = 20;

// ---- tiny per-user cache so the page paints instantly on every visit ----
const cacheKey = (uid) => `wisp_calls_cache_${uid}`;
const favKey = (uid) => `wisp_call_favs_${uid}`;
function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "") ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full — cache is optional */
  }
}

const CallsHeader = ({ context }) => context.header;
const CallsEmpty = ({ context }) => (
  <div className="rail-panel-empty">
    <PhoneIcon size={34} />
    <p>{context.filter === "missed" ? "No missed calls." : "Your voice and video calls will appear here."}</p>
  </div>
);
const CallsFooter = ({ context }) =>
  context.loadingMore ? <div className="explorer-loading-more">Loading more…</div> : <div style={{ height: 96 }} />;
const CALLS_COMPONENTS = { Header: CallsHeader, EmptyPlaceholder: CallsEmpty, Footer: CallsFooter };

function describe(call) {
  const { kind, status, durationSec = 0 } = call.callInfo;
  const label = kind === "video" ? "Video call" : "Voice call";
  if (status === "missed") return `Missed ${label.toLowerCase()}`;
  if (status === "declined") return `${label} declined`;
  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  return `${minutes > 0 ? `${minutes}m ` : ""}${seconds}s`;
}

// Collapse back-to-back entries with the same person + outcome into one row
// with a count — "Dhruv (3)" — exactly like WhatsApp's call list.
function groupCalls(calls, selfId) {
  const rows = [];
  for (const call of calls) {
    const outgoing = (call.sender?._id || call.sender) === selfId;
    const missed = call.callInfo.status === "missed";
    const key = `${call.conversation?._id}|${outgoing}|${missed}|${call.callInfo.kind}`;
    const prev = rows[rows.length - 1];
    if (prev && prev.key === key) {
      prev.count += 1;
      continue;
    }
    rows.push({ key, id: call._id, call, count: 1, outgoing, missed });
  }
  return rows;
}

function peerOf(call, selfId) {
  const c = call.conversation;
  if (c?.isGroup) return { displayName: c.name, avatar: c.avatar, avatarColor: "#64748b" };
  return c?.participants?.find((p) => (p._id || p) !== selfId) || call.sender || {};
}

function SkeletonRows() {
  return (
    <div className="calls-skeleton" aria-busy="true" aria-label="Loading calls">
      {Array.from({ length: 8 }).map((_, i) => (
        <div className="call-log-row" key={i} style={{ pointerEvents: "none" }}>
          <span className="skeleton" style={{ width: 46, height: 46, borderRadius: "50%" }} />
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="skeleton" style={{ width: `${40 + ((i * 13) % 30)}%`, height: 13 }} />
            <span className="skeleton" style={{ width: "32%", height: 10 }} />
          </span>
        </div>
      ))}
    </div>
  );
}

// "New call": search your contacts (by name or @username — Wisp has no phone
// numbers, so this doubles as the dial pad) and place a voice or video call
// straight from here. Star people to pin them to Favourites.
function NewCallSheet({ onClose, favs, toggleFav, placeCall }) {
  const [contacts, setContacts] = useState(null);
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    client
      .get("/users/contacts")
      .then((res) => setContacts(res.data.contacts || []))
      .catch(() => setContacts([]));
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, "");
    const all = (contacts || []).slice().sort((a, b) => a.displayName.localeCompare(b.displayName));
    return q ? all.filter((c) => c.displayName.toLowerCase().includes(q) || c.username?.toLowerCase().includes(q)) : all;
  }, [contacts, query]);

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal new-call-sheet">
        <div className="modal-header">
          <h2>New call</h2>
          <button className="icon-btn btn-sm" onClick={onClose} title="Close (Esc)">
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="new-call-search">
          <SearchIcon size={16} />
          <input
            ref={inputRef}
            placeholder="Search name or @username"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="new-call-list">
          {contacts === null && <SkeletonRows />}
          {contacts && list.length === 0 && (
            <p className="posts-empty">{contacts.length ? "No contacts match." : "Add contacts to start calling them."}</p>
          )}
          {list.map((c) => (
            <div className="new-call-row" key={c._id}>
              <Avatar user={c} size={42} />
              <span className="new-call-text">
                <strong>{c.displayName}</strong>
                <span>@{c.username}</span>
              </span>
              <button
                className={`icon-btn btn-sm ${favs.includes(c._id) ? "fav-on" : ""}`}
                title={favs.includes(c._id) ? "Remove from favourites" : "Add to favourites"}
                onClick={() => toggleFav(c._id)}
              >
                {favs.includes(c._id) ? <StarFilledIcon size={17} /> : <StarIcon size={17} />}
              </button>
              <button className="icon-btn call-act" title="Voice call" onClick={() => { onClose(); placeCall(c, "audio"); }}>
                <PhoneIcon size={18} />
              </button>
              <button className="icon-btn call-act" title="Video call" onClick={() => { onClose(); placeCall(c, "video"); }}>
                <VideoIcon size={18} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

function NewCallIcon({ size = 24 }) {
  return (
    <span className="calls-fab-icon">
      <PhoneIcon size={size} />
      <b aria-hidden="true">+</b>
    </span>
  );
}

export default function CallsPanel({ onOpenSettings, onOpenNewCall }) {
  const { user } = useAuth();
  const { openConversation, startDirectConversation } = useChat();
  const { startCall, call: activeCall } = useCall();
  const { socket } = useSocket();
  const { showToast } = useToast();

  // Cached copy first → the list is on screen on the very first frame.
  const [calls, setCalls] = useState(() => readJson(cacheKey(user._id), []));
  const [loading, setLoading] = useState(() => readJson(cacheKey(user._id), []).length === 0);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState("all"); // all | missed
  const [showNew, setShowNew] = useState(false);
  const [favs, setFavs] = useState(() => readJson(favKey(user._id), []));
  const [favPeople, setFavPeople] = useState([]);
  const [retry, setRetry] = useState(0);
  const reloadRef = useRef(() => {});

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setFailed(false);
      try {
        const res = await client.get("/messages/calls", { params: { limit: PAGE } });
        const next = res.data.calls || [];
        if (silent) {
          // Background refresh: update the newest page but keep any older
          // pages the person already scrolled through.
          setCalls((prev) => {
            const oldest = next.length ? new Date(next[next.length - 1].createdAt).getTime() : Infinity;
            const tail = prev.filter((c) => new Date(c.createdAt).getTime() < oldest);
            const merged = [...next, ...tail];
            writeJson(cacheKey(user._id), merged.slice(0, PAGE));
            return merged;
          });
          setHasMore((h) => h || !!res.data.hasMore);
        } else {
          setCalls(next);
          setHasMore(!!res.data.hasMore);
          writeJson(cacheKey(user._id), next);
        }
      } catch {
        // Keep showing the cached list if we have one; only show the error
        // state when there is nothing to show at all.
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [user._id]
  );
  reloadRef.current = () => load({ silent: true });

  useEffect(() => {
    load();
  }, [load, retry]);

  useEffect(() => {
    function onMessage(message) {
      if (message.callInfo) reloadRef.current();
    }
    socket?.on("message:new", onMessage);
    return () => socket?.off("message:new", onMessage);
  }, [socket]);
  useLiveRefresh(() => reloadRef.current(), { pollMs: 60000 });

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !calls.length) return;
    setLoadingMore(true);
    try {
      const before = calls[calls.length - 1].createdAt;
      const res = await client.get("/messages/calls", { params: { limit: PAGE, before } });
      const next = res.data.calls || [];
      setCalls((prev) => {
        const have = new Set(prev.map((c) => c._id));
        return [...prev, ...next.filter((c) => !have.has(c._id))];
      });
      setHasMore(!!res.data.hasMore);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [calls, hasMore, loadingMore]);

  // Favourites: stored locally, resolved to people from the contact list.
  useEffect(() => {
    if (!favs.length) {
      setFavPeople([]);
      return;
    }
    client
      .get("/users/contacts")
      .then((res) => setFavPeople((res.data.contacts || []).filter((c) => favs.includes(c._id))))
      .catch(() => {});
  }, [favs]);

  function toggleFav(id) {
    setFavs((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      writeJson(favKey(user._id), next);
      return next;
    });
  }

  // Place a call straight from this page (no need to open the chat first).
  async function placeCall(person, kind) {
    if (activeCall) {
      showToast("You're already in a call");
      return;
    }
    try {
      const conv = await startDirectConversation(person._id);
      await startCall(conv, kind);
    } catch {
      showToast("Couldn't start the call", "danger");
    }
  }

  async function callBack(row, kind) {
    const conv = row.call.conversation;
    if (!conv || conv.isGroup) return openConversation(conv?._id);
    const peer = peerOf(row.call, user._id);
    return placeCall(peer, kind || row.call.callInfo.kind);
  }

  const rows = useMemo(() => {
    const visible = filter === "missed" ? calls.filter((c) => c.callInfo.status === "missed") : calls;
    return groupCalls(visible, user._id);
  }, [calls, filter, user._id]);

  const menuItems = [
    { label: "New call", icon: <PhoneIcon size={15} />, onClick: () => setShowNew(true) },
    { label: "Refresh", icon: <RefreshIcon size={15} />, onClick: () => load() },
    { divider: true },
    { label: filter === "missed" ? "Show all calls" : "Show missed only", onClick: () => setFilter((f) => (f === "missed" ? "all" : "missed")) },
    { divider: true },
    { label: "Settings", icon: <SettingsIcon size={15} />, onClick: onOpenSettings },
  ];

  const header = (
    <div className="calls-header-block">
      <div className="calls-quick">
        <button className="calls-quick-btn" onClick={() => setShowNew(true)}>
          <span className="calls-quick-icon"><PhoneIcon size={22} /></span>
          <span>New call</span>
        </button>
        <button className="calls-quick-btn" onClick={() => setShowNew(true)}>
          <span className="calls-quick-icon"><StarFilledIcon size={22} /></span>
          <span>Favourites</span>
        </button>
      </div>
      {favPeople.length > 0 && (
        <div className="calls-favs" aria-label="Favourites">
          {favPeople.map((p) => (
            <button key={p._id} className="calls-fav" onClick={() => placeCall(p, "audio")} title={`Call ${p.displayName}`}>
              <Avatar user={p} size={48} />
              <span>{p.displayName.split(" ")[0]}</span>
            </button>
          ))}
        </div>
      )}
      <div className="calls-filters" role="tablist">
        <button role="tab" aria-selected={filter === "all"} className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
        <button role="tab" aria-selected={filter === "missed"} className={filter === "missed" ? "active" : ""} onClick={() => setFilter("missed")}>Missed</button>
      </div>
      <div className="calls-recent-title">Recent</div>
    </div>
  );

  return (
    <aside className="rail-panel calls-panel">
      <div className="rail-panel-header">
        {!loading && calls.length > 0 && <span className="rail-panel-count">{calls.length} Logs</span>}
        <h2>Calls</h2>
        <div className="explorer-header-actions">
          <button className="icon-btn primary-icon-btn" title="New call" onClick={() => setShowNew(true)}>
            <PhoneIcon size={17} />
          </button>
          <PanelMenuButton title="Calls menu" items={menuItems} />
        </div>
      </div>

      {loading ? (
        // The quick actions / filters never wait for the log: they render
        // immediately and only the rows below show a skeleton.
        <div className="calls-list" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {header}
          <SkeletonRows />
        </div>
      ) : failed && calls.length === 0 ? (
        <div className="calls-list" style={{ flex: 1, minHeight: 0 }}>
          {header}
          <div className="rail-panel-empty rail-panel-empty-tall">
            <p>Call history is unavailable. Check your connection and try again.</p>
            <button className="btn btn-primary btn-sm" onClick={() => setRetry((n) => n + 1)}>Retry</button>
          </div>
        </div>
      ) : (
        <Virtuoso
          className="calls-list"
          style={{ flex: 1, minHeight: 0 }}
          data={rows}
          context={{ header, filter, loadingMore }}
          computeItemKey={(index, row) => row.id}
          increaseViewportBy={{ top: 200, bottom: 400 }}
          endReached={loadMore}
          components={CALLS_COMPONENTS}
          itemContent={(index, row) => {
            const peer = peerOf(row.call, user._id);
            const isVideo = row.call.callInfo.kind === "video";
            return (
              <div className="call-log-row">
                <button className="call-log-main" type="button" onClick={() => openConversation(row.call.conversation?._id)}>
                  <Avatar user={peer} size={46} />
                  <span className="call-log-details">
                    <span className={`call-log-name ${row.missed ? "missed" : ""}`}>
                      {peer?.displayName || "Unknown"}
                      {row.count > 1 && <span className="call-log-count"> ({row.count})</span>}
                    </span>
                    <span className={`call-log-summary ${row.missed ? "missed" : ""}`}>
                      {row.outgoing ? <PhoneOutgoingIcon size={14} /> : <PhoneIncomingIcon size={14} />}
                      {describe(row.call)} · {formatListTime(row.call.createdAt)}
                    </span>
                  </span>
                </button>
                <button
                  className="icon-btn call-act"
                  title={isVideo ? "Video call" : "Voice call"}
                  aria-label={`${isVideo ? "Video" : "Voice"} call ${peer?.displayName || ""}`}
                  onClick={() => callBack(row)}
                  disabled={!!activeCall}
                >
                  {isVideo ? <VideoIcon size={20} /> : <PhoneIcon size={20} />}
                </button>
              </div>
            );
          }}
        />
      )}

      {/* WhatsApp-style floating "new call" button (phones) */}
      <button
        type="button"
        className="calls-fab"
        title="New call"
        aria-label="New call"
        onClick={() => (onOpenNewCall ? onOpenNewCall() : setShowNew(true))}
      >
        <NewCallIcon size={26} />
      </button>

      {showNew && (
        <NewCallSheet onClose={() => setShowNew(false)} favs={favs} toggleFav={toggleFav} placeCall={placeCall} />
      )}
    </aside>
  );
}
