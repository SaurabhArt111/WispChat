import { useCallback, useRef } from "react";
import { togglePostLike } from "../api/posts";
import { useToast } from "../context/ToastContext";

/**
 * Optimistic like / unlike for a post. `post` + `onChange(nextPost)` are the
 * caller's state. Returns { toggleLike, likeOnly } — `likeOnly` is what
 * double-tap uses: it only ever adds a like, never removes one.
 */
export default function usePostLike(post, onChange) {
  const { showToast } = useToast();
  const postRef = useRef(post);
  postRef.current = post;
  const inFlight = useRef(false);

  const toggleLike = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const before = postRef.current;
    const optimistic = {
      ...before,
      likedByMe: !before.likedByMe,
      likeCount: Math.max(0, before.likeCount + (before.likedByMe ? -1 : 1)),
    };
    onChange(optimistic);
    try {
      const res = await togglePostLike(before._id);
      onChange({ ...optimistic, likedByMe: res.likedByMe, likeCount: res.likeCount });
    } catch {
      onChange(before);
      showToast("Couldn't update like", "danger");
    } finally {
      inFlight.current = false;
    }
  }, [onChange, showToast]);

  const likeOnly = useCallback(() => {
    if (!postRef.current.likedByMe) toggleLike();
  }, [toggleLike]);

  return { toggleLike, likeOnly };
}
