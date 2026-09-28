import { useCallback, useEffect, useRef, useState } from "react";
import { VirtuosoGrid } from "react-virtuoso";
import client from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import Modal from "../common/Modal";
import MobileMoreButton from "./MobileMoreButton";
import PostThumb from "../Posts/PostThumb";
import PostViewerModal from "../Posts/PostViewerModal";
import PostUploadModal from "../Posts/PostUploadModal";
import PostsGrid from "../Posts/PostsGrid";
import { fetchExploreFeed, fetchUserPosts, MAX_POSTS_PER_USER } from "../../api/posts";
import { CloseIcon, CompassIcon, PlusIcon, SearchIcon, UsersIcon } from "../common/Icons";
import "../../styles/railPanels.css";
import "../../styles/posts.css";

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
        <div className="rail-panel-list">
          {searching && results === null && <p className="posts-empty">Searching…</p>}
          {results?.length === 0 && !searching && <p className="posts-empty">No people found.</p>}
          {results?.map((u) => (
            <button key={u._id} className="explorer-user-row" onClick={() => setProfileUser(u)}>
              <Avatar user={u} size={42} />
              <span className="explorer-user-text">
                <strong>{u.displayName}</strong>
                <span>@{u.username}</span>
              </span>
            </button>
          ))}
        </div>
      ) : loading ? (
        <div className="rail-panel-empty rail-panel-empty-tall"><p>Loading posts…</p></div>
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
      {profileUser && <UserProfileSheet person={profileUser} onClose={() => setProfileUser(null)} />}
    </aside>
  );
}

// Tapping a search result: their posts, plus an "Add contact" action —
// people are discovered here but can only be chatted with once added.
function UserProfileSheet({ person, onClose }) {
  const { showToast } = useToast();
  const [sent, setSent] = useState(false);

  async function addContact() {
    try {
      await client.post("/users/friend-requests", { userId: person._id });
      setSent(true);
      showToast("Request sent", "success");
    } catch (err) {
      showToast(err?.response?.data?.message || "Couldn't send request", "danger");
    }
  }

  return (
    <Modal title={person.displayName} onClose={onClose}>
      <div className="explorer-profile-head">
        <Avatar user={person} size={64} />
        <div>
          <strong>{person.displayName}</strong>
          <span>@{person.username}</span>
          {person.about && <p>{person.about}</p>}
        </div>
      </div>
      <button className="btn btn-primary btn-sm" onClick={addContact} disabled={sent}>
        <UsersIcon size={14} /> {sent ? "Request sent" : "Add contact"}
      </button>
      <PostsGrid userId={person._id} />
    </Modal>
  );
}
