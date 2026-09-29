import { mediaUrl } from "../../api/config";
import { HeartIcon, CommentIcon, PlayIcon } from "../common/Icons";

// Square grid tile used by Explorer, profile grids and the user-posts
// sheet. Videos are shown as a paused first frame with a play badge.
// `showAuthor` adds a small "Friend" tag on posts from people you know.
export default function PostThumb({ post, onClick, showAuthor = false }) {
  return (
    <button type="button" className="post-thumb" onClick={() => onClick?.(post)}>
      {post.kind === "video" ? (
        <video src={mediaUrl(post.url)} preload="metadata" muted playsInline />
      ) : (
        <img src={mediaUrl(post.url)} alt={post.caption || "Post"} loading="lazy" />
      )}
      {post.kind === "video" && (
        <span className="post-thumb-badge">
          <PlayIcon size={14} />
        </span>
      )}
      {showAuthor && post.isContact && !post.isMine && <span className="post-thumb-friend">Friend</span>}
      <span className="post-thumb-overlay">
        <span><HeartIcon size={15} filled /> {post.likeCount}</span>
        <span><CommentIcon size={15} /> {post.commentCount}</span>
      </span>
    </button>
  );
}
