import Post from "../models/Post.js";
import User from "../models/User.js";
import { kindFromMime } from "../middleware/upload.js";

// Instagram-style cap: at most 6 posts on a profile at once. Unlike Status,
// posts don't expire on their own, so this is a hard ceiling the person
// has to delete an old post to get past — enforced here rather than in the
// schema so the error message can be specific.
export const MAX_POSTS_PER_USER = 6;

const AUTHOR_FIELDS = "username displayName avatar avatarColor";

function serializePost(post, viewerId) {
  const likes = post.likes || [];
  const comments = post.comments || [];
  return {
    _id: post._id,
    user: post.user,
    kind: post.kind,
    url: post.url,
    mimeType: post.mimeType,
    caption: post.caption,
    edited: !!post.edited,
    createdAt: post.createdAt,
    likeCount: likes.length,
    likedByMe: likes.some((id) => String(id?._id || id) === String(viewerId)),
    commentCount: comments.length,
    comments: comments
      .slice()
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((c) => ({
        _id: c._id,
        user: c.user,
        text: c.text,
        edited: !!c.edited,
        createdAt: c.createdAt,
        mine: String(c.user?._id || c.user) === String(viewerId),
      })),
  };
}

export async function createPost(req, res) {
  const { caption = "" } = req.body;
  const file = req.file;
  if (!file) return res.status(400).json({ message: "An image or video is required" });

  const count = await Post.countDocuments({ user: req.user._id });
  if (count >= MAX_POSTS_PER_USER) {
    return res.status(400).json({
      message: `You can only have ${MAX_POSTS_PER_USER} posts at once. Delete an old one to add a new one.`,
    });
  }

  const kind = kindFromMime(file.mimetype) === "video" ? "video" : "image";
  let post = await Post.create({
    user: req.user._id,
    kind,
    url: `/uploads/${file.mediaFolder}/${file.filename}`,
    mimeType: file.mimetype,
    caption: caption.trim(),
  });
  post = await post.populate("user", AUTHOR_FIELDS);
  res.status(201).json({ post: serializePost(post.toObject(), req.user._id) });
}

// A person's own profile (via ProfileModal) or someone else's (via
// ContactInfoPanel's Posts tab) — most recent first.
export async function getUserPosts(req, res) {
  const { userId } = req.params;
  const posts = await Post.find({ user: userId })
    .sort({ createdAt: -1 })
    .populate("user", AUTHOR_FIELDS)
    .populate("comments.user", AUTHOR_FIELDS)
    .lean();
  res.json({ posts: posts.map((p) => serializePost(p, req.user._id)) });
}

export async function getPostById(req, res) {
  const post = await Post.findById(req.params.id)
    .populate("user", AUTHOR_FIELDS)
    .populate("comments.user", AUTHOR_FIELDS)
    .lean();
  if (!post) return res.status(404).json({ message: "Post not found" });
  res.json({ post: serializePost(post, req.user._id) });
}

// The Explorer tab: a random sample of posts from across the app (minus
// anyone blocked in either direction), refreshed with a new shuffle on
// every load — same "endless discovery" feel as Instagram's Explore grid,
// just without a personalization model behind it.
export async function getExploreFeed(req, res) {
  const limit = Math.min(120, Number(req.query.limit) || 60);

  const blockedByMe = req.user.blocked || [];
  const blockedMe = await User.find({ blocked: req.user._id }, "_id");
  const excludedAuthors = [...blockedByMe, ...blockedMe.map((u) => u._id)];

  const sample = await Post.aggregate([
    { $match: { user: { $nin: excludedAuthors } } },
    { $sample: { size: limit } },
  ]);
  const populated = await Post.populate(sample, [
    { path: "user", select: AUTHOR_FIELDS },
    { path: "comments.user", select: AUTHOR_FIELDS },
  ]);

  res.json({ posts: populated.map((p) => serializePost(p, req.user._id)) });
}

export async function likePost(req, res) {
  const { id } = req.params;
  const post = await Post.findById(id);
  if (!post) return res.status(404).json({ message: "Post not found" });

  const idx = post.likes.findIndex((u) => String(u) === String(req.user._id));
  if (idx >= 0) post.likes.splice(idx, 1);
  else post.likes.push(req.user._id);
  await post.save();

  if (String(post.user) !== String(req.user._id) && idx < 0) {
    req.io?.to(`user:${post.user}`).emit("post:liked", {
      postId: post._id,
      by: { _id: req.user._id, displayName: req.user.displayName },
    });
  }

  res.json({ likeCount: post.likes.length, likedByMe: idx < 0 });
}

export async function commentOnPost(req, res) {
  const { id } = req.params;
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ message: "Comment can't be empty" });

  const post = await Post.findById(id);
  if (!post) return res.status(404).json({ message: "Post not found" });

  post.comments.push({ user: req.user._id, text: text.trim() });
  await post.save();
  await post.populate("comments.user", AUTHOR_FIELDS);
  const comment = post.comments[post.comments.length - 1];

  if (String(post.user) !== String(req.user._id)) {
    req.io?.to(`user:${post.user}`).emit("post:commented", { postId: post._id, comment });
  }

  res.status(201).json({
    comment: { ...comment.toObject(), mine: true },
    commentCount: post.comments.length,
  });
}

export async function deleteComment(req, res) {
  const { id, commentId } = req.params;
  const post = await Post.findById(id);
  if (!post) return res.status(404).json({ message: "Post not found" });

  const comment = post.comments.id(commentId);
  if (!comment) return res.status(404).json({ message: "Comment not found" });
  const isOwnComment = String(comment.user) === String(req.user._id);
  const isPostOwner = String(post.user) === String(req.user._id);
  if (!isOwnComment && !isPostOwner) {
    return res.status(403).json({ message: "Not your comment" });
  }
  comment.deleteOne();
  await post.save();
  res.json({ ok: true, commentCount: post.comments.length });
}

export async function deletePost(req, res) {
  const { id } = req.params;
  const post = await Post.findById(id);
  if (!post) return res.status(404).json({ message: "Post not found" });
  if (String(post.user) !== String(req.user._id)) {
    return res.status(403).json({ message: "You can only delete your own posts" });
  }
  await post.deleteOne();
  res.json({ ok: true });
}

// Edit your own post: change the caption, and/or swap the photo/video for a
// new one (multipart `file`). Either or both may be sent.
export async function updatePost(req, res) {
  const { id } = req.params;
  const post = await Post.findById(id);
  if (!post) return res.status(404).json({ message: "Post not found" });
  if (String(post.user) !== String(req.user._id)) {
    return res.status(403).json({ message: "You can only edit your own posts" });
  }

  let changed = false;
  if (typeof req.body.caption === "string") {
    const next = req.body.caption.trim().slice(0, 500);
    if (next !== post.caption) {
      post.caption = next;
      changed = true;
    }
  }
  if (req.file) {
    post.kind = kindFromMime(req.file.mimetype) === "video" ? "video" : "image";
    post.url = `/uploads/${req.file.mediaFolder}/${req.file.filename}`;
    post.mimeType = req.file.mimetype;
    changed = true;
  }
  if (changed) post.edited = true;
  await post.save();
  await post.populate([
    { path: "user", select: AUTHOR_FIELDS },
    { path: "comments.user", select: AUTHOR_FIELDS },
  ]);
  res.json({ post: serializePost(post.toObject(), req.user._id) });
}

// Edit your own comment.
export async function updateComment(req, res) {
  const { id, commentId } = req.params;
  const text = (req.body.text || "").trim();
  if (!text) return res.status(400).json({ message: "Comment can't be empty" });

  const post = await Post.findById(id);
  if (!post) return res.status(404).json({ message: "Post not found" });
  const comment = post.comments.id(commentId);
  if (!comment) return res.status(404).json({ message: "Comment not found" });
  if (String(comment.user) !== String(req.user._id)) {
    return res.status(403).json({ message: "You can only edit your own comments" });
  }
  comment.text = text.slice(0, 500);
  comment.edited = true;
  await post.save();
  res.json({ comment: { _id: comment._id, text: comment.text, edited: true } });
}
