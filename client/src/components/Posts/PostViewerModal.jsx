import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import { SafeImage, SafeVideo } from "../common/SafeMedia";
import { mediaUrl } from "../../api/config";
import { addPostComment, deletePost, deletePostComment, updatePost, updatePostComment } from "../../api/posts";
import usePostLike from "../../hooks/usePostLike";
import useDoubleTap from "../../hooks/useDoubleTap";
import { useLivePost } from "../../hooks/useLivePosts";
import { BackIcon, CheckIcon, ChevronDownIcon, CloseIcon, CommentIcon, EditIcon, HeartIcon, ImageIcon, SendPostIcon, TrashIcon } from "../common/Icons";
import { formatListTime } from "../../utils/time";
import "../../styles/posts.css";

// Desktop post view (a modal over Explore/profile, still on its own /post/:id
// route): media on the left; author, caption, comments, likes on the right.
// Arrow buttons / ← → keys step through the posts that follow, then
// suggestions from other people. Double-click (or double-tap) the media to
// like it with a heart animation. `onChange(post)` lets the parent keep its
// copy in sync; `onDeleted(id)` removes it from the parent's list.
export default function PostViewerModal({
  post: initial,
  onClose,
  onChange,
  onDeleted,
  onPrev,
  onNext,
  isPage = false,
}) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [post, setPost] = useState(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const isOwner = String(post.user?._id || post.user) === String(user._id);

  // --- editing (owner only): caption text and/or replacing the media ---
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.caption || "");
  const [newFile, setNewFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [heartBurst, setHeartBurst] = useState(null); // { n, x, y }
  const fileRef = useRef(null);
  const previewUrl = useMemo(() => (newFile ? URL.createObjectURL(newFile) : null), [newFile]);
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  // --- editing one of my own comments ---
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [commentDraft, setCommentDraft] = useState("");

  function startEdit() {
    setDraft(post.caption || "");
    setNewFile(null);
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setNewFile(null);
  }
  async function saveEdit() {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await updatePost(post._id, { caption: draft, file: newFile }, setProgress);
      // keep my like/comment state; the server response is the source of truth for media/caption
      update({ ...post, ...updated });
      setEditing(false);
      setNewFile(null);
      showToast("Post updated", "success");
    } catch (err) {
      showToast(err?.response?.data?.message || "Couldn't save changes", "danger");
    } finally {
      setSaving(false);
      setProgress(0);
    }
  }
  async function saveCommentEdit(c) {
    const value = commentDraft.trim();
    if (!value) return;
    try {
      const res = await updatePostComment(post._id, c._id, value);
      update({
        ...post,
        comments: post.comments.map((x) => (x._id === c._id ? { ...x, text: res.text, edited: true } : x)),
      });
      setEditingCommentId(null);
    } catch {
      showToast("Couldn't edit comment", "danger");
    }
  }

  const update = useCallback(
    (next) => {
      setPost(next);
      onChange?.(next);
    },
    [onChange]
  );

  // Likes/comments/edits from other people arrive live; a deletion closes the viewer.
  useLivePost(setPost, { onGone: () => { onDeleted?.(post._id); onClose(); } });

  const { toggleLike, likeOnly } = usePostLike(post, update);

  const burst = useCallback((point) => setHeartBurst((b) => ({ n: (b?.n || 0) + 1, x: point?.x, y: point?.y })), []);
  const doubleTap = useDoubleTap({
    onDouble: (point) => {
      if (editing) return;
      burst(point);
      likeOnly();
    },
  });

  // ← / → move between posts; Esc closes (Esc handled by overlay click/close button already).
  useEffect(() => {
    if (isPage) return;
    function onKey(e) {
      if (e.target?.closest?.("input, textarea")) return;
      if (e.key === "ArrowRight") onNext?.();
      else if (e.key === "ArrowLeft") onPrev?.();
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPage, onNext, onPrev, onClose]);

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

  const viewer = (
      <div className={`post-viewer ${isPage ? "post-viewer-page" : ""}`}>
        {isPage && (
          <header className="post-viewer-routebar">
            <button className="post-viewer-back" onClick={onClose}>
              <BackIcon size={19} />
              <span>Back</span>
            </button>
            <strong>Post</strong>
            <span className="post-viewer-routebar-spacer" />
          </header>
        )}
        <div className="post-viewer-body">
        <div className="post-viewer-media" {...doubleTap}>
          {heartBurst && (
            <div
              key={heartBurst.n}
              className={`post-viewer-heart-burst ${heartBurst.x != null ? "at-point" : ""}`}
              style={heartBurst.x != null ? { "--hx": `${heartBurst.x}px`, "--hy": `${heartBurst.y}px` } : undefined}
              onAnimationEnd={() => setHeartBurst(null)}
              aria-hidden="true"
            >
              <HeartIcon size={92} filled />
            </div>
          )}
          {/* {onPrev && (
            <button className="post-viewer-nav prev" onClick={onPrev} title="Previous post" data-no-tap>
              <ChevronDownIcon size={22} />
            </button>
          )}
          {onNext && (
            <button className="post-viewer-nav next" onClick={onNext} title="Next post" data-no-tap>
              <ChevronDownIcon size={22} />
            </button>
          )} */}
          {newFile ? (
            newFile.type.startsWith("video") ? (
              <video src={previewUrl} controls muted playsInline />
            ) : (
              <img src={previewUrl} alt="New media preview" />
            )
          ) : post.kind === "video" ? (
            <SafeVideo src={mediaUrl(post.url)} controls autoPlay playsInline />
          ) : (
            <SafeImage src={mediaUrl(post.url)} alt={post.caption || "Post"} />
          )}
        </div>

        <div className="post-viewer-side">
          <div className="post-viewer-author">
            <Avatar user={post.user} size={34} />
            <div className="post-viewer-author-text">
              <strong>{post.user?.displayName}</strong>
              <span>@{post.user?.username} · {formatListTime(post.createdAt)}</span>
            </div>
            {isOwner && !editing && (
              <>
                <button className="icon-btn btn-sm" onClick={startEdit} title="Edit post">
                  <EditIcon size={16} />
                </button>
                <button className="icon-btn btn-sm" onClick={handleDeletePost} title="Delete post">
                  <TrashIcon size={16} />
                </button>
              </>
            )}
          </div>

          {editing ? (
            <div className="post-edit-box">
              <textarea
                className="input post-upload-caption"
                rows={3}
                maxLength={500}
                autoFocus
                value={draft}
                placeholder="Write a caption…"
                onChange={(e) => setDraft(e.target.value)}
              />
              <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => setNewFile(e.target.files?.[0] || null)} />
              <div className="post-edit-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={saving}>
                  <ImageIcon size={14} /> {newFile ? "Choose another" : "Change photo/video"}
                </button>
                <span className="post-edit-spacer" />
                <button className="btn btn-ghost btn-sm" onClick={cancelEdit} disabled={saving}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={saving}>
                  <CheckIcon size={14} /> {saving ? (newFile ? `${Math.round(progress * 100)}%` : "Saving…") : "Save"}
                </button>
              </div>
            </div>
          ) : (
            (post.caption || post.edited) && (
              <p className="post-viewer-caption">
                {post.caption}
                {post.edited && <span className="post-edited-tag"> · edited</span>}
              </p>
            )
          )}

          <div className="post-viewer-comments">
            {post.comments.length === 0 ? (
              <p className="post-viewer-empty">No comments yet. Be the first.</p>
            ) : (
              post.comments.map((c) => (
                <div className="post-comment" key={c._id}>
                  <Avatar user={c.user} size={26} />
                  {editingCommentId === c._id ? (
                    <div className="post-comment-edit">
                      <input
                        className="input"
                        autoFocus
                        value={commentDraft}
                        maxLength={500}
                        onChange={(e) => setCommentDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveCommentEdit(c);
                          if (e.key === "Escape") setEditingCommentId(null);
                        }}
                      />
                      <button className="icon-btn btn-sm" onClick={() => saveCommentEdit(c)} title="Save"><CheckIcon size={14} /></button>
                      <button className="icon-btn btn-sm" onClick={() => setEditingCommentId(null)} title="Cancel"><CloseIcon size={14} /></button>
                    </div>
                  ) : (
                    <>
                      <div className="post-comment-body">
                        <span className="post-comment-name">{c.user?.displayName}</span> {c.text}
                        {c.edited && <span className="post-edited-tag"> · edited</span>}
                      </div>
                      {c.mine && (
                        <button
                          className="icon-btn btn-sm"
                          onClick={() => {
                            setEditingCommentId(c._id);
                            setCommentDraft(c.text);
                          }}
                          title="Edit comment"
                        >
                          <EditIcon size={13} />
                        </button>
                      )}
                      {(c.mine || isOwner) && (
                        <button className="icon-btn btn-sm" onClick={() => handleDeleteComment(c)} title="Delete comment">
                          <TrashIcon size={13} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="post-viewer-actions">
            <button
              className={`icon-btn post-like-btn ${post.likedByMe ? "post-liked" : ""}`}
              onClick={() => {
                if (!post.likedByMe) burst();
                toggleLike();
              }}
              title={post.likedByMe ? "Unlike" : "Like"}
            >
              <span key={post.likedByMe ? "on" : "off"} className="post-like-icon">
                <HeartIcon size={22} filled={post.likedByMe} />
              </span>
            </button>
            <span className="post-viewer-count"><CommentIcon size={16} /> {post.commentCount}</span>
            <span className="post-viewer-count">{post.likeCount} {post.likeCount === 1 ? "like" : "likes"}</span>
          </div>

          <form className="post-viewer-form" onSubmit={handleComment}>
            <input
              className="input"
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
        {!isPage && (
          <button className="icon-btn post-viewer-close" onClick={onClose} title="Close">
            <CloseIcon size={20} />
          </button>
        )}
      </div>
  );

  if (isPage) return viewer;

  return createPortal(
    <div className="modal-overlay post-viewer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {viewer}
    </div>,
    document.body
  );
}
