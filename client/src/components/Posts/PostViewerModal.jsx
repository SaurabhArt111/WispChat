import { useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import { mediaUrl } from "../../api/config";
import { addPostComment, deletePost, deletePostComment, togglePostLike } from "../../api/posts";
import { CloseIcon, CommentIcon, HeartIcon, SendPostIcon, TrashIcon } from "../common/Icons";
import { formatListTime } from "../../utils/time";
import "../../styles/posts.css";

// Full post view: media + like + comments. `onChange(post)` lets the parent
// grid keep its counts in sync; `onDeleted(id)` removes it from the grid.
export default function PostViewerModal({ post: initial, onClose, onChange, onDeleted }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [post, setPost] = useState(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const isOwner = String(post.user?._id || post.user) === String(user._id);

  function update(next) {
    setPost(next);
    onChange?.(next);
  }

  async function handleLike() {
    // optimistic
    const optimistic = {
      ...post,
      likedByMe: !post.likedByMe,
      likeCount: post.likeCount + (post.likedByMe ? -1 : 1),
    };
    update(optimistic);
    try {
      const res = await togglePostLike(post._id);
      update({ ...optimistic, likedByMe: res.likedByMe, likeCount: res.likeCount });
    } catch {
      update(post);
      showToast("Couldn't update like", "danger");
    }
  }

  async function handleComment(e) {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const res = await addPostComment(post._id, value);
      update({
        ...post,
        comments: [...post.comments, res.comment],
        commentCount: res.commentCount,
      });
      setText("");
    } catch (err) {
      showToast(err?.response?.data?.message || "Couldn't post comment", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteComment(c) {
    try {
      const res = await deletePostComment(post._id, c._id);
      update({
        ...post,
        comments: post.comments.filter((x) => x._id !== c._id),
        commentCount: res.commentCount,
      });
    } catch {
      showToast("Couldn't delete comment", "danger");
    }
  }

  async function handleDeletePost() {
    if (!window.confirm("Delete this post? This can't be undone.")) return;
    try {
      await deletePost(post._id);
      onDeleted?.(post._id);
      onClose();
    } catch {
      showToast("Couldn't delete post", "danger");
    }
  }

  return createPortal(
    <div className="modal-overlay post-viewer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="post-viewer">
        <button className="icon-btn post-viewer-close" onClick={onClose} title="Close">
          <CloseIcon size={18} />
        </button>

        <div className="post-viewer-media">
          {post.kind === "video" ? (
            <video src={mediaUrl(post.url)} controls autoPlay playsInline />
          ) : (
            <img src={mediaUrl(post.url)} alt={post.caption || "Post"} />
          )}
        </div>

        <div className="post-viewer-side">
          <div className="post-viewer-author">
            <Avatar user={post.user} size={34} />
            <div className="post-viewer-author-text">
              <strong>{post.user?.displayName}</strong>
              <span>@{post.user?.username} · {formatListTime(post.createdAt)}</span>
            </div>
            {isOwner && (
              <button className="icon-btn btn-sm" onClick={handleDeletePost} title="Delete post">
                <TrashIcon size={16} />
              </button>
            )}
          </div>

          {post.caption && <p className="post-viewer-caption">{post.caption}</p>}

          <div className="post-viewer-comments">
            {post.comments.length === 0 ? (
              <p className="post-viewer-empty">No comments yet. Be the first.</p>
            ) : (
              post.comments.map((c) => (
                <div className="post-comment" key={c._id}>
                  <Avatar user={c.user} size={26} />
                  <div className="post-comment-body">
                    <span className="post-comment-name">{c.user?.displayName}</span> {c.text}
                  </div>
                  {(c.mine || isOwner) && (
                    <button className="icon-btn btn-sm" onClick={() => handleDeleteComment(c)} title="Delete comment">
                      <TrashIcon size={13} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="post-viewer-actions">
            <button className={`icon-btn ${post.likedByMe ? "post-liked" : ""}`} onClick={handleLike} title="Like">
              <HeartIcon size={22} filled={post.likedByMe} />
            </button>
            <span className="post-viewer-count"><CommentIcon size={16} /> {post.commentCount}</span>
            <span className="post-viewer-count">{post.likeCount} {post.likeCount === 1 ? "like" : "likes"}</span>
          </div>

          <form className="sidebar-search" onSubmit={handleComment}>
            <input
              placeholder="Add a comment…"
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="icon-btn primary-icon-btn" type="submit" disabled={!text.trim() || busy} title="Post comment">
              <SendPostIcon size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
