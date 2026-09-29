import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { fetchPost } from "../../api/posts";
import PostViewerModal from "./PostViewerModal";
import { BackIcon } from "../common/Icons";
import "../../styles/posts.css";

export default function PostViewerPage() {
  const { postId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const fallbackFrom = sessionStorage.getItem("wisp-return-path") || "/explore";
  const fallbackId = location.pathname.split("/").filter(Boolean)[1] || null;
  const resolvedPostId = postId || fallbackId;
  const seededPost = location.state?.post?._id === resolvedPostId ? location.state.post : null;
  const [post, setPost] = useState(seededPost);
  const [loading, setLoading] = useState(!seededPost);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (location.state?.from) {
      sessionStorage.setItem("wisp-return-path", location.state.from);
    }
  }, [location.state]);

  useEffect(() => {
    if (!resolvedPostId) {
      setPost(null);
      setLoading(false);
      setFailed(true);
      return;
    }

    if (seededPost) {
      setPost(seededPost);
      setLoading(false);
      setFailed(false);
      return;
    }

    let active = true;
    setPost(null);
    setLoading(true);
    setFailed(false);
    fetchPost(resolvedPostId)
      .then((next) => active && setPost(next))
      .catch(() => active && setFailed(true))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [resolvedPostId, seededPost]);

  function close() {
    const returnTo = location.state?.from || fallbackFrom;
    const safeReturn = returnTo && !returnTo.startsWith("/post/") ? returnTo : "/explore";
    navigate(safeReturn, { replace: true });
  }

  return (
    <main className="post-viewer-route">
      {post ? (
        <PostViewerModal
          key={post._id}
          post={post}
          isPage
          onClose={close}
          onChange={setPost}
        />
      ) : loading ? (
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