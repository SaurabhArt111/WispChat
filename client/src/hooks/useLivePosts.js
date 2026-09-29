import { useEffect, useRef } from "react";
import { useSocket } from "../context/SocketContext";
import { useAuth } from "../context/AuthContext";

const same = (a, b) => String(a) === String(b);

// Applies one realtime post event to one post. Returns the (possibly
// unchanged) post — or `null` if the post was deleted.
export function applyPostEvent(post, evt, p, meId) {
  if (!post) return post;
  const id = p.postId ?? p.post?._id;
  if (!same(post._id, id)) return post;
  switch (evt) {
    case "post:deleted":
      return null;
    case "post:updated":
      return {
        ...post,
        ...p.post,
        // viewer-specific / heavy fields stay as the local copy has them
        comments: post.comments,
        likedByMe: post.likedByMe,
        isContact: post.isContact,
        isMine: post.isMine,
      };
    case "post:stats":
      return {
        ...post,
        likeCount: p.likeCount,
        commentCount: p.commentCount ?? post.commentCount,
        likedByMe: same(p.likerId, meId) ? p.liked : post.likedByMe,
      };
    case "post:comment": {
      const comments = post.comments || [];
      const exists = comments.some((c) => same(c._id, p.comment?._id));
      return {
        ...post,
        commentCount: p.commentCount,
        comments: post.comments ? (exists ? comments : [...comments, p.comment]) : post.comments,
      };
    }
    case "post:comment-deleted":
      return {
        ...post,
        commentCount: p.commentCount,
        comments: post.comments ? post.comments.filter((c) => !same(c._id, p.commentId)) : post.comments,
      };
    case "post:comment-updated":
      return {
        ...post,
        comments: post.comments
          ? post.comments.map((c) => (same(c._id, p.commentId) ? { ...c, text: p.text, edited: true } : c))
          : post.comments,
      };
    default:
      return post;
  }
}

const EVENTS = [
  "post:updated",
  "post:stats",
  "post:comment",
  "post:comment-deleted",
  "post:comment-updated",
  "post:deleted",
];

/**
 * Keeps a list of posts live: like/comment counts, edits and deletions from
 * anyone show up instantly. `setPosts` is a React state setter for an array.
 * `onNew(post)` fires when somebody publishes a new post.
 */
export default function useLivePosts(setPosts, { onNew } = {}) {
  const { socket } = useSocket();
  const { user } = useAuth();
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  const meId = user?._id;

  useEffect(() => {
    if (!socket) return;
    const listeners = EVENTS.map((evt) => {
      const fn = (p) =>
        setPosts((list) => {
          let changed = false;
          const next = [];
          for (const item of list) {
            const out = applyPostEvent(item, evt, p, meId);
            if (out !== item) changed = true;
            if (out) next.push(out);
          }
          return changed ? next : list;
        });
      socket.on(evt, fn);
      return [evt, fn];
    });
    const handleNew = (p) => p?.post && onNewRef.current?.(p.post);
    socket.on("post:new", handleNew);
    return () => {
      listeners.forEach(([evt, fn]) => socket.off(evt, fn));
      socket.off("post:new", handleNew);
    };
  }, [socket, setPosts, meId]);
}

/** Same, for a single post held in state. `onGone` fires if it gets deleted. */
export function useLivePost(setPost, { onGone } = {}) {
  const { socket } = useSocket();
  const { user } = useAuth();
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  const meId = user?._id;

  useEffect(() => {
    if (!socket) return;
    const listeners = EVENTS.map((evt) => {
      const fn = (p) =>
        setPost((cur) => {
          const out = applyPostEvent(cur, evt, p, meId);
          if (out === null && cur) setTimeout(() => goneRef.current?.(), 0);
          return out === null ? cur : out;
        });
      socket.on(evt, fn);
      return [evt, fn];
    });
    return () => listeners.forEach(([evt, fn]) => socket.off(evt, fn));
  }, [socket, setPost, meId]);
}
