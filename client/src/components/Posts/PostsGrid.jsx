import { useEffect, useState } from "react";
import { useToast } from "../../context/ToastContext";
import { fetchUserPosts, MAX_POSTS_PER_USER } from "../../api/posts";
import PostThumb from "./PostThumb";
import PostViewerModal from "./PostViewerModal";
import PostUploadModal from "./PostUploadModal";
import { PlusIcon } from "../common/Icons";
import "../../styles/posts.css";

// A person's posts (max 6). `editable` = it's my own profile, so show the
// upload tile and allow deleting. Only ≤6 tiles exist, so this is a plain
// grid — virtualizing 6 items would only add overhead.
export default function PostsGrid({ userId, editable = false }) {
  const { showToast } = useToast();
  const [posts, setPosts] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let active = true;
    setPosts(null);
    fetchUserPosts(userId)
      .then((p) => active && setPosts(p))
      .catch(() => {
        if (active) {
          setPosts([]);
          showToast("Couldn't load posts", "danger");
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (posts === null) return <p className="posts-empty">Loading posts…</p>;

  const remaining = MAX_POSTS_PER_USER - posts.length;

  return (
    <div className="posts-grid-wrap">
      {editable && (
        <p className="posts-count">{posts.length}/{MAX_POSTS_PER_USER} posts</p>
      )}
      {posts.length === 0 && !editable && <p className="posts-empty">No posts yet.</p>}
      <div className="posts-grid">
        {posts.map((p) => (
          <PostThumb key={p._id} post={p} onClick={setViewing} />
        ))}
        {editable && remaining > 0 && (
          <button type="button" className="post-thumb post-thumb-add" onClick={() => setUploading(true)}>
            <PlusIcon size={26} />
            <span>Add post</span>
          </button>
        )}
      </div>

      {viewing && (
        <PostViewerModal
          post={viewing}
          onClose={() => setViewing(null)}
          onChange={(next) => setPosts((list) => list.map((x) => (x._id === next._id ? next : x)))}
          onDeleted={(id) => setPosts((list) => list.filter((x) => x._id !== id))}
        />
      )}
      {uploading && (
        <PostUploadModal
          remaining={remaining}
          onClose={() => setUploading(false)}
          onCreated={(post) => setPosts((list) => [post, ...list])}
        />
      )}
    </div>
  );
}
