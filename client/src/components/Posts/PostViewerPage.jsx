import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { fetchExploreFeed, fetchPost } from "../../api/posts";
import useMediaQuery from "../../hooks/useMediaQuery";
import useLivePosts from "../../hooks/useLivePosts";
import PostViewerModal from "./PostViewerModal";
import PostFeedPage from "./PostFeedPage";
import { BackIcon } from "../common/Icons";
import "../../styles/posts.css";

// Route component for /post/:postId.
//   • Desktop  → a modal on top of whatever you came from (Explore, profile…),
//                with ← / → to step through the following posts.
//   • Mobile   → a full page with a vertical snap-scroll feed.
// Either way the list is: the post you opened, then the posts that followed
// it where you were browsing, then endless suggestions from other people.
const SUGGEST_BATCH = 10;

export default function PostViewerPage() {
  const { postId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 769px)");

  const seeded = location.state?.post?._id === postId ? location.state.post : null;
  const queueSeed = location.state?.post?._id === postId ? location.state.queue || [] : [];

  const [items, setItems] = useState(seeded ? [seeded, ...queueSeed.filter((p) => p._id !== seeded._id)] : []);
  const [loading, setLoading] = useState(!seeded);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [index, setIndex] = useState(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const suggestBusy = useRef(false);
  const initialId = useRef(postId);

  // Opened via a direct link / refresh: fetch the post itself.
  useEffect(() => {
    if (seeded) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    fetchPost(postId)
      .then((p) => {
        if (!active) return;
        setItems([p]);
        setIndex(0);
      })
      .catch(() => active && setFailed(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  // Suggestions from other people, never repeating anything already queued.
  const loadMore = useCallback(async () => {
    if (suggestBusy.current || !hasMore) return;
    suggestBusy.current = true;
    setLoadingMore(true);
    try {
      const exclude = itemsRef.current.map((p) => p._id);
      const { posts, hasMore: more } = await fetchExploreFeed({ limit: SUGGEST_BATCH, scope: "all", exclude });
      setItems((list) => {
        const have = new Set(list.map((p) => p._id));
        return [...list, ...posts.filter((p) => !have.has(p._id))];
      });
      setHasMore(more && posts.length > 0);
    } catch {
      setHasMore(false);
    } finally {
      suggestBusy.current = false;
      setLoadingMore(false);
    }
  }, [hasMore]);

  // Make sure there is always something after the current post.
  useEffect(() => {
    if (items.length && index >= items.length - 3 && hasMore) loadMore();
  }, [index, items.length, hasMore, loadMore]);

  // Live counts / edits / deletions for everything in the list.
  useLivePosts(setItems);

  const from = location.state?.from || sessionStorage.getItem("wisp-return-path") || "/explore";
  const close = useCallback(() => {
    const safe = from && !from.startsWith("/post/") ? from : "/explore";
    navigate(safe, { replace: true });
  }, [from, navigate]);

  // Keep the address bar on whichever post is showing (cosmetic; the route
  // stays mounted so scrolling never reloads anything).
  const syncUrl = useCallback((post, i) => {
    setIndex(i);
    if (post && window.location.pathname !== `/post/${post._id}`) {
      window.history.replaceState(window.history.state, "", `/post/${post._id}`);
    }
  }, []);

  if (!items.length) {
    return (
      <main className="post-viewer-route">
        {loading ? (
          <div className="post-route-message" aria-busy="true">Loading post…</div>
        ) : (
          <div className="post-route-message">
            <p>{failed ? "Couldn't load this post." : "This post isn't available."}</p>
            <button className="btn btn-ghost btn-sm" onClick={close}>
              <BackIcon size={16} /> Back
            </button>
          </div>
        )}
      </main>
    );
  }

  if (!isDesktop) {
    return (
      <PostFeedPage
        items={items}
        setItems={setItems}
        loadMore={loadMore}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onClose={close}
        onActive={syncUrl}
      />
    );
  }

  // ---- Desktop modal ----
  const current = items[Math.min(index, items.length - 1)];
  const step = (d) => {
    const next = Math.min(items.length - 1, Math.max(0, index + d));
    if (next === index) return;
    syncUrl(items[next], next);
  };
  const changeCurrent = (next) => setItems((list) => list.map((p) => (p._id === next._id ? { ...p, ...next } : p)));

  return (
    <PostViewerModal
      key={current._id}
      post={current}
      onClose={close}
      onChange={changeCurrent}
      onDeleted={(id) => {
        setItems((list) => list.filter((p) => p._id !== id));
      }}
      onPrev={index > 0 ? () => step(-1) : undefined}
      onNext={index < items.length - 1 ? () => step(1) : undefined}
    />
  );
}
