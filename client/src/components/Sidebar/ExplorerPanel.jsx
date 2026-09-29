import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { VirtuosoGrid } from "react-virtuoso";
import client from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import MobileMoreButton from "./MobileMoreButton";
import PostThumb from "../Posts/PostThumb";
import PostUploadModal from "../Posts/PostUploadModal";
import ProfileView from "../Profile/ProfileView";
import { fetchExploreFeed, fetchUserPosts, MAX_POSTS_PER_USER } from "../../api/posts";
import { CloseIcon, CompassIcon, PlusIcon, RefreshIcon, SearchIcon } from "../common/Icons";
import useLivePosts from "../../hooks/useLivePosts";
import useLiveRefresh from "../../hooks/useLiveRefresh";
import { openPostRoute } from "../../utils/openPost";
import { useChat } from "../../context/ChatContext";
import "../../styles/railPanels.css";
import "../../styles/posts.css";

// Placeholder tiles shown while the feed loads. Same 3-column geometry as the
// real grid, so nothing jumps when the posts arrive.
function ExplorerSkeleton() {
  return (
    <div className="explorer-grid-body" aria-busy="true" aria-label="Loading posts">
      <div className="explorer-grid explorer-skeleton-grid">
        {Array.from({ length: 21 }).map((_, i) => (
          <div className="explorer-grid-item" key={i}>
            <div className="skeleton post-skel-tile" style={{ animationDelay: `${(i % 6) * 60}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function GridFooter({ context }) {
  const { loadingMore, hasMore, onShuffle } = context;
  return (
    <div className="explorer-footer">
      {loadingMore ? (
        <span className="explorer-loading-more" aria-busy="true">Loading more…</span>
      ) : hasMore ? null : (
        <>
          <p className="explorer-caught-up">You're all caught up</p>
          <button className="btn btn-ghost btn-sm" onClick={onShuffle}>
            <RefreshIcon size={14} /> Shuffle
          </button>
        </>
      )}
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="rail-panel-list" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div className="explorer-user-row" key={i} style={{ pointerEvents: "none" }}>
          <span className="skeleton" style={{ width: 42, height: 42, borderRadius: "50%" }} />
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="skeleton" style={{ width: "45%", height: 13 }} />
            <span className="skeleton" style={{ width: "28%", height: 10 }} />
          </span>
        </div>
      ))}
    </div>
  );
}

// Explore: an endless, freshly-shuffled grid of posts from people you know
// AND people you don't, with tabs to narrow it ("For you" / "Friends" /
// "Discover") and a search bar that finds people by @username / name / ID.
// The grid is virtualized (VirtuosoGrid) so only the tiles near the
// viewport are in the DOM, and it loads another batch whenever you near the
// bottom. Likes, comments, edits, deletions and brand-new posts arrive live
// over the socket — no refresh needed.
const SCOPES = [
  { id: "all", label: "For you" },
  { id: "contacts", label: "Friends" },
  { id: "discover", label: "Discover" },
];
const PAGE_SIZE = 24;
export default function ExplorerPanel({ onOpenMore }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [scope, setScope] = useState("all");
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [freshPosts, setFreshPosts] = useState([]); // published by others while you browse
  const gridRef = useRef(null);
  const postsRef = useRef(posts);
  postsRef.current = posts;
  const loadSeq = useRef(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [profileUser, setProfileUser] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [myPostCount, setMyPostCount] = useState(0);
  const searchSeq = useRef(0);
  const remaining = MAX_POSTS_PER_USER - myPostCount;
  const { startDirectConversation, openConversation } = useChat();
  const navigate = useNavigate();
  const location = useLocation();
  const [contactIdSet, setContactIdSet] = useState(() => new Set());

  const loadContacts = useCallback(
    () =>
      client
        .get("/users/contacts")
        .then((r) => setContactIdSet(new Set((r.data.contacts || []).map((c) => String(c._id)))))
        .catch(() => {}),
    []
  );
  useEffect(() => {
    loadContacts();
  }, [loadContacts]);
  useLiveRefresh(loadContacts, { events: ["contacts:changed", "friend-request:resolved"] });

  async function openChatWith(userId) {
    try {
      const conv = await startDirectConversation(userId);
      setProfileUser(null);
      await openConversation(conv._id);
    } catch {
      showToast("Could not start conversation", "danger");
    }
  }

  const loadMine = useCallback(async () => {
    try {
      const mine = await fetchUserPosts(user._id);
      setMyPostCount(mine.length);
    } catch {
      /* count stays as-is */
    }
  }, [user._id]);
  useEffect(() => {
    loadMine();
  }, [loadMine]);
  useLiveRefresh(loadMine, { events: ["post:new", "post:deleted"] });

  // Fresh shuffle (first load, tab change, Shuffle button).
  const loadFeed = useCallback(
    async (nextScope = scope) => {
      const seq = ++loadSeq.current;
      setLoading(true);
      setFailed(false);
      setFreshPosts([]);
      try {
        const { posts: batch, hasMore: more } = await fetchExploreFeed({ limit: PAGE_SIZE, scope: nextScope });
        if (seq !== loadSeq.current) return;
        setPosts(batch);
        setHasMore(more);
      } catch {
        if (seq === loadSeq.current) setFailed(true);
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [scope]
  );

  useEffect(() => {
    loadFeed(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // Infinite scroll: ask for a batch that excludes everything already shown.
  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    const seq = loadSeq.current;
    setLoadingMore(true);
    try {
      const shown = postsRef.current.map((p) => p._id);
      const { posts: batch, hasMore: more } = await fetchExploreFeed({ limit: PAGE_SIZE, scope, exclude: shown });
      if (seq !== loadSeq.current) return;
      setPosts((list) => {
        const have = new Set(list.map((p) => p._id));
        return [...list, ...batch.filter((p) => !have.has(p._id))];
      });
      setHasMore(more && batch.length > 0);
    } catch {
      /* a failed page just stops loading more; the Shuffle button still works */
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loading, hasMore, scope]);

  // Live updates (counts, edits, deletions) + brand-new posts from others.
  useLivePosts(setPosts, {
    onNew: (post) => {
      if (String(post.user?._id || post.user) === String(user._id)) return; // my own is added on upload
      const isKnown = contactIdSet.has(String(post.user?._id || post.user));
      if (scope === "contacts" && !isKnown) return;
      if (scope === "discover" && isKnown) return;
      setFreshPosts((cur) =>
        cur.some((p) => p._id === post._id) || postsRef.current.some((p) => p._id === post._id)
          ? cur
          : [{ ...post, isContact: isKnown, likedByMe: false, comments: [] }, ...cur]
      );
    },
  });
  useLivePosts(setFreshPosts);

  function showFresh() {
    setPosts((list) => {
      const have = new Set(list.map((p) => p._id));
      return [...freshPosts.filter((p) => !have.has(p._id)), ...list];
    });
    setFreshPosts([]);
    gridRef.current?.scrollToIndex?.({ index: 0, behavior: "smooth" });
  }

  // Debounced people search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      try {
        const res = await client.get("/users/search", { params: { q } });
        if (seq === searchSeq.current) setResults(res.data.users || []);
      } catch {
        if (seq === searchSeq.current) setResults([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const openPost = (post) => {
    const idx = posts.findIndex((p) => p._id === post._id);
    openPostRoute(navigate, location, post, idx >= 0 ? posts.slice(idx + 1) : []);
  };

  return (
    <aside className="rail-panel explorer-panel">
      <div className="rail-panel-header">
        <h2>Explore</h2>
        <div className="explorer-header-actions">
          <button
            className="icon-btn primary-icon-btn"
            title={remaining > 0 ? "New post" : "Post limit reached (6). Delete one first."}
            onClick={() =>
              remaining > 0
                ? setUploading(true)
                : showToast("You've reached 6 posts. Delete one from your profile to add another.", "info")
            }
          >
            <PlusIcon size={18} />
          </button>
          {onOpenMore && <MobileMoreButton onClick={onOpenMore} />}
        </div>
      </div>

      <div className="explorer-search">
        <SearchIcon size={16} />
        <input
          placeholder="Search people by @username, name or user ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="icon-btn btn-sm" onClick={() => setQuery("")} title="Clear">
            <CloseIcon size={14} />
          </button>
        )}
      </div>

      {!query.trim() && (
        <div className="explorer-tabs" role="tablist" aria-label="Explore filter">
          {SCOPES.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={scope === t.id}
              className={`explorer-tab ${scope === t.id ? "active" : ""}`}
              onClick={() => scope !== t.id && setScope(t.id)}
            >
              {t.label}
            </button>
          ))}
          <button className="icon-btn btn-sm explorer-refresh" title="Shuffle" onClick={() => loadFeed()}>
            <RefreshIcon size={15} />
          </button>
        </div>
      )}
      {!query.trim() && freshPosts.length > 0 && (
        <button className="explorer-fresh-pill" onClick={showFresh}>
          {freshPosts.length} new {freshPosts.length === 1 ? "post" : "posts"} · tap to show
        </button>
      )}

      {results !== null || searching ? (
        results === null ? (
          <SearchSkeleton />
        ) : (
          <div className="rail-panel-list">
            {results.length === 0 && <p className="posts-empty">No people found.</p>}
            {results.map((u) => (
              <button key={u._id} className="explorer-user-row" onClick={() => setProfileUser(u)}>
                <Avatar user={u} size={42} />
                <span className="explorer-user-text">
                  <strong>{u.displayName}</strong>
                  <span>@{u.username}</span>
                </span>
              </button>
            ))}
          </div>
        )
      ) : loading ? (
        <ExplorerSkeleton />
      ) : failed ? (
        <div className="rail-panel-empty rail-panel-empty-tall">
          <p>Couldn't load Explore. Check your connection and try again.</p>
          <button className="btn btn-primary btn-sm" onClick={() => loadFeed()}>Retry</button>
        </div>
      ) : posts.length === 0 ? (
        <div className="rail-panel-empty rail-panel-empty-tall">
          <CompassIcon size={34} />
          <p>
            {scope === "contacts"
              ? "No posts from your friends yet."
              : scope === "discover"
              ? "No posts from new people right now."
              : "No posts yet. Be the first to share something."}
          </p>
          {scope !== "all" && (
            <button className="btn btn-ghost btn-sm" onClick={() => setScope("all")}>Show everything</button>
          )}
        </div>
      ) : (
        <div className="explorer-grid-body">
          <VirtuosoGrid
            ref={gridRef}
            style={{ height: "100%" }}
            data={posts}
            context={{ loadingMore, hasMore, onShuffle: () => loadFeed() }}
            computeItemKey={(index, post) => post._id}
            listClassName="explorer-grid"
            itemClassName="explorer-grid-item"
            overscan={500}
            endReached={loadMore}
            itemContent={(index, post) => <PostThumb post={post} onClick={openPost} showAuthor />}
            components={{ Footer: GridFooter }}
          />
        </div>
      )}

      {uploading && (
        <PostUploadModal
          remaining={remaining}
          onClose={() => setUploading(false)}
          onCreated={(post) => {
            setPosts((list) => (list.some((p) => p._id === post._id) ? list : [{ ...post, isMine: true }, ...list]));
            setMyPostCount((c) => c + 1);
          }}
        />
      )}
      {profileUser && (
        <ProfileView
          person={profileUser}
          isContact={contactIdSet.has(String(profileUser._id))}
          onMessage={() => openChatWith(profileUser._id)}
          onClose={() => setProfileUser(null)}
        />
      )}
    </aside>
  );
}
