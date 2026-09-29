import { useCallback, useEffect, useRef, useState } from "react";
import { VirtuosoGrid } from "react-virtuoso";
import client from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import MobileMoreButton from "./MobileMoreButton";
import PostThumb from "../Posts/PostThumb";
import PostViewerModal from "../Posts/PostViewerModal";
import PostUploadModal from "../Posts/PostUploadModal";
import ProfileView from "../Profile/ProfileView";
import { fetchExploreFeed, fetchUserPosts, MAX_POSTS_PER_USER } from "../../api/posts";
import { CloseIcon, CompassIcon, PlusIcon, SearchIcon } from "../common/Icons";
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

// Instagram-style Explore: a random, re-shuffled grid of everyone's posts,
// with a search bar on top that finds people by @username / name / user ID.
// The grid is virtualized (VirtuosoGrid) so only the tiles near the
// viewport are in the DOM no matter how many posts were fetched.
export default function ExplorerPanel({ onOpenMore }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [profileUser, setProfileUser] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [myPostCount, setMyPostCount] = useState(0);
  const searchSeq = useRef(0);
  const { startDirectConversation, openConversation } = useChat();
  const [contactIdSet, setContactIdSet] = useState(() => new Set());

  useEffect(() => {
    client
      .get("/users/contacts")
      .then((r) => setContactIdSet(new Set((r.data.contacts || []).map((c) => String(c._id)))))
      .catch(() => {});
  }, []);

  async function openChatWith(userId) {
    try {
      const conv = await startDirectConversation(userId);
      setProfileUser(null);
      await openConversation(conv._id);
    } catch {
      showToast("Could not start conversation", "danger");
    }
  }

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [feed, mine] = await Promise.all([fetchExploreFeed(60), fetchUserPosts(user._id)]);
      setPosts(feed);
      setMyPostCount(mine.length);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [user._id]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

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

  const remaining = MAX_POSTS_PER_USER - myPostCount;

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
          <button className="btn btn-primary btn-sm" onClick={loadFeed}>Retry</button>
        </div>
      ) : posts.length === 0 ? (
        <div className="rail-panel-empty rail-panel-empty-tall">
          <CompassIcon size={34} />
          <p>No posts yet. Be the first to share something.</p>
        </div>
      ) : (
        <div className="explorer-grid-body">
          <VirtuosoGrid
            style={{ height: "100%" }}
            data={posts}
            computeItemKey={(index, post) => post._id}
            listClassName="explorer-grid"
            itemClassName="explorer-grid-item"
            overscan={400}
            itemContent={(index, post) => <PostThumb post={post} onClick={setViewing} />}
            components={{
              Footer: () => (
                <div className="explorer-footer">
                  <button className="btn btn-ghost btn-sm" onClick={loadFeed}>Shuffle</button>
                </div>
              ),
            }}
          />
        </div>
      )}

      {viewing && (
        <PostViewerModal
          post={viewing}
          onClose={() => setViewing(null)}
          onChange={(next) => setPosts((list) => list.map((p) => (p._id === next._id ? next : p)))}
          onDeleted={(id) => {
            setPosts((list) => list.filter((p) => p._id !== id));
            setMyPostCount((c) => Math.max(0, c - 1));
          }}
        />
      )}
      {uploading && (
        <PostUploadModal
          remaining={remaining}
          onClose={() => setUploading(false)}
          onCreated={(post) => {
            setPosts((list) => [post, ...list]);
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
