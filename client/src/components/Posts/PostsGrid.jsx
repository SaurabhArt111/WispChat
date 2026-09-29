import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useToast } from "../../context/ToastContext";
import { fetchUserPosts, MAX_POSTS_PER_USER } from "../../api/posts";
import PostThumb from "./PostThumb";
import PostUploadModal from "./PostUploadModal";
import { PlusIcon } from "../common/Icons";
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

  useEffect(() => {
    let active = true;
    setPosts(null);
    fetchUserPosts(userId)
      .then((p) => {
        if (!active) return;
        setPosts(p);
        onCountChange?.(p.length);
      })
      .catch(() => {
        if (active) {
          setPosts([]);
          onCountChange?.(0);
          showToast("Couldn't load posts", "danger");
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
  const openPost = (post) => {
    const from = `${location.pathname}${location.search}`;
    sessionStorage.setItem("wisp-return-path", from);
    navigate(`/post/${post._id}`, { state: { post, from } });
  };

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
            setPosts((list) => [post, ...list]);
            onCountChange?.(posts.length + 1);
          }}
        />
      )}
    </div>
  );
}
