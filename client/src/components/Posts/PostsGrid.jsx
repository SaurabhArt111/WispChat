import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useToast } from "../../context/ToastContext";
import { fetchUserPosts, MAX_POSTS_PER_USER } from "../../api/posts";
import PostThumb from "./PostThumb";
import PostUploadModal from "./PostUploadModal";
import { PlusIcon } from "../common/Icons";
import useLivePosts from "../../hooks/useLivePosts";
import useLiveRefresh from "../../hooks/useLiveRefresh";
import { openPostRoute } from "../../utils/openPost";
import "../../styles/posts.css";

// A person's posts (max 6). `editable` = it's my own profile, so show the
// upload tile and allow deleting. Only ≤6 tiles exist, so this is a plain
// grid — virtualizing 6 items would only add overhead.
export default function PostsGrid({ userId, editable = false, showLimit = editable, onCountChange }) {
  const { showToast } = useToast();
  const [posts, setPosts] = useState(null);
  const [uploading, setUploading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const load = useCallback(async () => {
    try {
      const p = await fetchUserPosts(userId);
      setPosts(p);
      return true;
    } catch {
      return false;
    }
  }, [userId]);

  useEffect(() => {
    let active = true;
    setPosts(null);
    load().then((ok) => {
      if (active && !ok) {
        setPosts([]);
        showToast("Couldn't load posts", "danger");
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Keep the parent's count in sync with whatever is on screen.
  useEffect(() => {
    if (posts) onCountChange?.(posts.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts?.length]);

  // Live: counts, edits, deletions, and this person publishing a new post.
  const setLive = useCallback((updater) => setPosts((cur) => (cur ? updater(cur) : cur)), []);
  useLivePosts(setLive, {
    onNew: (post) => {
      if (String(post.user?._id || post.user) !== String(userId)) return;
      load();
    },
  });
  useLiveRefresh(load, { pollMs: 120000 });

  if (posts === null) {
    return (
      <div className="posts-skeleton" aria-busy="true" aria-label="Loading posts">
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="skeleton" key={i} />
        ))}
      </div>
    );
  }

  const remaining = MAX_POSTS_PER_USER - posts.length;
  const openPost = (post) => openPostRoute(navigate, location, post, posts.filter((p) => p._id !== post._id));

  return (
    <div className="posts-grid-wrap">
      {editable && showLimit && (
        <p className="posts-count">{posts.length}/{MAX_POSTS_PER_USER} posts</p>
      )}
      {posts.length === 0 && !editable && <p className="posts-empty">No posts yet.</p>}
      <div className="posts-grid">
        {posts.map((p) => (
          <PostThumb key={p._id} post={p} onClick={openPost} />
        ))}
        {editable && remaining > 0 && (
          <button type="button" className="post-thumb post-thumb-add" onClick={() => setUploading(true)}>
            <PlusIcon size={26} />
            <span>Add post</span>
          </button>
        )}
      </div>

      {uploading && (
        <PostUploadModal
          remaining={remaining}
          onClose={() => setUploading(false)}
          onCreated={(post) => {
            setPosts((list) => (list.some((x) => x._id === post._id) ? list : [post, ...list]));
          }}
        />
      )}
    </div>
  );
}
