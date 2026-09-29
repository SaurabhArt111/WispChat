import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import { mediaUrl } from "../../api/config";
import { addPostComment, deletePost, deletePostComment, updatePost, updatePostComment } from "../../api/posts";
import usePostLike from "../../hooks/usePostLike";
import useDoubleTap from "../../hooks/useDoubleTap";
import {
  BackIcon,
  CheckIcon,
  CloseIcon,
  CommentIcon,
  DotsHorizontalIcon,
  EditIcon,
  ForwardIcon,
  HeartIcon,
  ImageIcon,
  PlayIcon,
  SendPostIcon,
  SpeakerIcon,
  TrashIcon,
} from "../common/Icons";
import { formatListTime } from "../../utils/time";
import "../../styles/posts.css";

// ---------------------------------------------------------------------------
// Mobile post viewer: a full-screen page on its own /post/:id route with a
// vertical, snap-scrolling feed. The post you opened is first; swipe up for
// the posts that followed it, then suggestions from other people. Double-tap
// any post to like it (heart bursts where you tapped); the URL follows
// whichever post is on screen. Comments live in a bottom sheet.
// ---------------------------------------------------------------------------

function CommentsSheet({ post, onChange, onClose }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const isOwner = String(post.user?._id || post.user) === String(user._id);
  const comments = post.comments || [];

  async function submit(e) {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const res = await addPostComment(post._id, value);
      onChange({
        ...post,
        comments: comments.some((c) => c._id === res.comment._id) ? comments : [...comments, res.comment],
        commentCount: res.commentCount,
      });
      setText("");
    } catch (err) {
      showToast(err?.response?.data?.message || "Couldn't post comment", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c) {
    try {
      const res = await deletePostComment(post._id, c._id);
      onChange({ ...post, comments: comments.filter((x) => x._id !== c._id), commentCount: res.commentCount });
    } catch {
      showToast("Couldn't delete comment", "danger");
    }
  }

  async function saveEdit(c) {
    const value = draft.trim();
    if (!value) return;
    try {
      const res = await updatePostComment(post._id, c._id, value);
      onChange({ ...post, comments: comments.map((x) => (x._id === c._id ? { ...x, text: res.text, edited: true } : x)) });
      setEditingId(null);
    } catch {
      showToast("Couldn't edit comment", "danger");
    }
  }

  return (
    <div className="post-sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="post-sheet" role="dialog" aria-label="Comments">
        <div className="post-sheet-head">
          <strong>Comments · {post.commentCount}</strong>
          <button className="icon-btn btn-sm" onClick={onClose} title="Close">
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="post-sheet-body">
          {comments.length === 0 ? (
            <p className="post-viewer-empty">No comments yet. Be the first.</p>
          ) : (
            comments.map((c) => (
              <div className="post-comment" key={c._id}>
                <Avatar user={c.user} size={30} />
                {editingId === c._id ? (
                  <div className="post-comment-edit">
                    <input
                      className="input"
                      autoFocus
                      value={draft}
                      maxLength={500}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveEdit(c)}
                    />
                    <button className="icon-btn btn-sm" onClick={() => saveEdit(c)} title="Save"><CheckIcon size={14} /></button>
                    <button className="icon-btn btn-sm" onClick={() => setEditingId(null)} title="Cancel"><CloseIcon size={14} /></button>
                  </div>
                ) : (
                  <>
                    <div className="post-comment-body">
                      <span className="post-comment-name">{c.user?.displayName}</span> {c.text}
                      {c.edited && <span className="post-edited-tag"> · edited</span>}
                    </div>
                    {c.mine && (
                      <button className="icon-btn btn-sm" onClick={() => { setEditingId(c._id); setDraft(c.text); }} title="Edit comment">
                        <EditIcon size={13} />
                      </button>
                    )}
                    {(c.mine || isOwner) && (
                      <button className="icon-btn btn-sm" onClick={() => remove(c)} title="Delete comment">
                        <TrashIcon size={13} />
                      </button>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>
        <form className="post-viewer-form" onSubmit={submit}>
          <input className="input" placeholder="Add a comment…" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
          <button className="icon-btn primary-icon-btn" type="submit" disabled={!text.trim() || busy} title="Post comment">
            <SendPostIcon size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}

function OwnerSheet({ post, onChange, onClose, onDeleted }) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState(post.caption || "");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await updatePost(post._id, { caption: draft, file }, setProgress);
      onChange({ ...post, ...updated });
      showToast("Post updated", "success");
      onClose();
    } catch (err) {
      showToast(err?.response?.data?.message || "Couldn't save changes", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this post? This can't be undone.")) return;
    try {
      await deletePost(post._id);
      onDeleted(post._id);
      onClose();
    } catch {
      showToast("Couldn't delete post", "danger");
    }
  }

  return (
    <div className="post-sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="post-sheet" role="dialog" aria-label="Edit post">
        <div className="post-sheet-head">
          <strong>Your post</strong>
          <button className="icon-btn btn-sm" onClick={onClose} title="Close"><CloseIcon size={16} /></button>
        </div>
        <div className="post-sheet-body post-edit-box">
          <textarea
            className="input post-upload-caption"
            rows={3}
            maxLength={500}
            value={draft}
            placeholder="Write a caption…"
            onChange={(e) => setDraft(e.target.value)}
          />
          <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <div className="post-edit-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={saving}>
              <ImageIcon size={14} /> {file ? file.name.slice(0, 18) : "Change photo/video"}
            </button>
            <span className="post-edit-spacer" />
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
              <CheckIcon size={14} /> {saving ? (file ? `${Math.round(progress * 100)}%` : "Saving…") : "Save"}
            </button>
          </div>
          <button className="btn btn-ghost btn-sm post-danger-btn" onClick={remove}>
            <TrashIcon size={14} /> Delete post
          </button>
        </div>
      </div>
    </div>
  );
}

function FeedItem({ post, index, isActive, isNear, muted, onChange, onOpenComments, onOpenOwner, onShare }) {
  const { user } = useAuth();
  const videoRef = useRef(null);
  const [burst, setBurst] = useState(null);
  const [paused, setPaused] = useState(false);
  const { toggleLike, likeOnly } = usePostLike(post, onChange);
  const isMine = String(post.user?._id || post.user) === String(user._id);

  // Only the post on screen plays; the rest stay paused (saves bandwidth & battery).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isActive && !paused) v.play?.().catch(() => {});
    else v.pause?.();
  }, [isActive, paused, isNear]);
  useEffect(() => {
    if (!isActive) setPaused(false);
  }, [isActive]);

  const doubleTap = useDoubleTap({
    onDouble: (pt) => {
      setBurst((b) => ({ n: (b?.n || 0) + 1, x: pt.x, y: pt.y }));
      likeOnly();
    },
    onSingle: () => post.kind === "video" && setPaused((p) => !p),
  });

  return (
    <section className="post-feed-item" data-index={index} data-post-id={post._id}>
      <div className="post-feed-media" {...doubleTap}>
        {isNear ? (
          post.kind === "video" ? (
            <video
              ref={videoRef}
              src={mediaUrl(post.url)}
              loop
              playsInline
              muted={muted}
              preload={isActive ? "auto" : "metadata"}
            />
          ) : (
            <img src={mediaUrl(post.url)} alt={post.caption || "Post"} draggable={false} />
          )
        ) : (
          <div className="post-feed-placeholder" />
        )}
        {post.kind === "video" && paused && isActive && (
          <span className="post-feed-paused" aria-hidden="true"><PlayIcon size={34} /></span>
        )}
        {burst && (
          <div
            key={burst.n}
            className="post-viewer-heart-burst at-point"
            style={{ "--hx": `${burst.x}px`, "--hy": `${burst.y}px` }}
            onAnimationEnd={() => setBurst(null)}
            aria-hidden="true"
          >
            <HeartIcon size={92} filled />
          </div>
        )}
      </div>

      <div className="post-feed-rail" data-no-tap>
        <button
          className={`post-feed-action ${post.likedByMe ? "liked" : ""}`}
          onClick={() => {
            if (!post.likedByMe) setBurst((b) => ({ n: (b?.n || 0) + 1 }));
            toggleLike();
          }}
          title={post.likedByMe ? "Unlike" : "Like"}
        >
          <span key={post.likedByMe ? "on" : "off"} className="post-like-icon">
            <HeartIcon size={28} filled={post.likedByMe} />
          </span>
          <span>{post.likeCount}</span>
        </button>
        <button className="post-feed-action" onClick={() => onOpenComments(post._id)} title="Comments">
          <CommentIcon size={27} />
          <span>{post.commentCount}</span>
        </button>
        <button className="post-feed-action" onClick={() => onShare(post)} title="Share link">
          <ForwardIcon size={25} />
        </button>
        {isMine && (
          <button className="post-feed-action" onClick={() => onOpenOwner(post._id)} title="Edit or delete">
            <DotsHorizontalIcon size={25} />
          </button>
        )}
      </div>

      <div className="post-feed-meta" data-no-tap>
        <div className="post-feed-author">
          <Avatar user={post.user} size={34} />
          <div className="post-feed-author-text">
            <strong>{post.user?.displayName}</strong>
            <span>
              @{post.user?.username} · {formatListTime(post.createdAt)}
              {!isMine && (
                <em className={`post-feed-tag ${post.isContact ? "friend" : ""}`}>
                  {post.isContact ? "Friend" : "Suggested"}
                </em>
              )}
            </span>
          </div>
        </div>
        {(post.caption || post.edited) && (
          <p className="post-feed-caption">
            {post.caption}
            {post.edited && <span className="post-edited-tag"> · edited</span>}
          </p>
        )}
      </div>
    </section>
  );
}

export default function PostFeedPage({ items, setItems, loadMore, hasMore, loadingMore, onClose, onActive }) {
  const { showToast } = useToast();
  const scrollerRef = useRef(null);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [commentsFor, setCommentsFor] = useState(null);
  const [ownerFor, setOwnerFor] = useState(null);
  const hasVideo = items.some((p) => p.kind === "video");

  const changeItem = useCallback(
    (next) => setItems((list) => list.map((p) => (p._id === next._id ? { ...p, ...next } : p))),
    [setItems]
  );

  // Which post is on screen: the one that's mostly visible in the scroller.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive(Number(e.target.dataset.index));
        }
      },
      { root, threshold: [0.6] }
    );
    root.querySelectorAll("[data-index]").forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [items.length]);

  useEffect(() => {
    const cur = items[active];
    if (cur) onActive?.(cur, active);
    if (active >= items.length - 3 && hasMore) loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, items.length]);

  async function share(post) {
    const url = `${window.location.origin}/post/${post._id}`;
    try {
      if (navigator.share) await navigator.share({ url, title: `${post.user?.displayName} on Wisp` });
      else {
        await navigator.clipboard.writeText(url);
        showToast("Link copied");
      }
    } catch {
      /* dismissed the share sheet */
    }
  }

  const commentsPost = useMemo(() => items.find((p) => p._id === commentsFor), [items, commentsFor]);
  const ownerPost = useMemo(() => items.find((p) => p._id === ownerFor), [items, ownerFor]);

  return (
    <div className="post-feed-page">
      <header className="post-feed-topbar">
        <button className="post-feed-back" onClick={onClose} aria-label="Back">
          <BackIcon size={20} />
        </button>
        <strong>Posts</strong>
        {hasVideo ? (
          <button className={`post-feed-back ${muted ? "" : "on"}`} onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"}>
            <SpeakerIcon size={19} />
          </button>
        ) : (
          <span className="post-feed-back placeholder" />
        )}
      </header>

      <div className="post-feed-scroller" ref={scrollerRef}>
        {items.map((post, i) => (
          <FeedItem
            key={post._id}
            post={post}
            index={i}
            isActive={i === active}
            isNear={Math.abs(i - active) <= 2}
            muted={muted}
            onChange={changeItem}
            onOpenComments={setCommentsFor}
            onOpenOwner={setOwnerFor}
            onShare={share}
          />
        ))}
        <section className="post-feed-end">
          {loadingMore ? "Finding more posts…" : hasMore ? "" : "You're all caught up"}
        </section>
      </div>

      {commentsPost && <CommentsSheet post={commentsPost} onChange={changeItem} onClose={() => setCommentsFor(null)} />}
      {ownerPost && (
        <OwnerSheet
          post={ownerPost}
          onChange={changeItem}
          onClose={() => setOwnerFor(null)}
          onDeleted={(id) => setItems((list) => list.filter((p) => p._id !== id))}
        />
      )}
    </div>
  );
}
