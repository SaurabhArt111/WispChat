import Post from "../models/Post.js";
import User from "../models/User.js";
import mongoose from "mongoose";
import { kindFromMime } from "../middleware/upload.js";
import { emitExplore } from "../utils/realtime.js";

// Instagram-style cap: at most 6 posts on a profile at once. Unlike Status,
// posts don't expire on their own, so this is a hard ceiling the person
// has to delete an old post to get past — enforced here rather than in the
// schema so the error message can be specific.
export const MAX_POSTS_PER_USER = 6;

const AUTHOR_FIELDS = "username displayName avatar avatarColor";

function serializePost(post, viewerId, contactSet) {
  const likes = post.likes || [];
  const authorId = String(post.user?._id || post.user);
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
    // Lets Explore label posts from people you know vs. people you don't.
    isContact: contactSet ? contactSet.has(authorId) : undefined,
    isMine: authorId === String(viewerId),
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

// Viewer-agnostic version pushed to every connected client over the socket.
// Clients fill in likedByMe / isContact themselves.
function broadcastShape(post) {
  const p = post.toObject ? post.toObject() : post;
  return {
    _id: p._id,
    user: p.user,
    kind: p.kind,
    url: p.url,
    mimeType: p.mimeType,
    caption: p.caption,
    edited: !!p.edited,
    createdAt: p.createdAt,
    likeCount: (p.likes || []).length,
    commentCount: (p.comments || []).length,
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
  emitExplore(req.io, "post:new", { post: broadcastShape(post) });
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
  res.json({ post: serializePost(post, req.user._id, new Set((req.user.contacts || []).map(String))) });
}

// The Explorer tab: posts from across the app — people you know AND people
// you don't — freshly shuffled on every load, minus anyone blocked in either
// direction. It's cursor-less infinite scroll: the client passes back the
// ids it has already seen (`exclude`) and gets a new batch each time.
//
//   scope=all       (default) roughly half from your contacts, half from
//                   everyone else, interleaved so the grid feels varied
//   scope=contacts  only people in your contact list
//   scope=discover  only people you're NOT connected with
export async function getExploreFeed(req, res) {
  const limit = Math.max(1, Math.min(60, Number(req.query.limit) || 24));
  const scope = ["all", "contacts", "discover"].includes(req.query.scope) ? req.query.scope : "all";

  const exclude = String(req.query.exclude || "")
    .split(",")
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .slice(-400)
    .map((id) => new mongoose.Types.ObjectId(id));

  const blockedByMe = (req.user.blocked || []).map((id) => new mongoose.Types.ObjectId(String(id)));
  const blockedMe = await User.find({ blocked: req.user._id }, "_id").lean();
  const blockedIds = [...blockedByMe, ...blockedMe.map((u) => u._id)];
  const blockedSet = new Set(blockedIds.map(String));
  const contactIds = (req.user.contacts || [])
    .map((id) => new mongoose.Types.ObjectId(String(id)))
    .filter((id) => !blockedSet.has(String(id)));
  const contactSet = new Set(contactIds.map(String));

  const sample = (userMatch, size) =>
    size <= 0
      ? Promise.resolve([])
      : Post.aggregate([
          { $match: { user: userMatch, _id: { $nin: exclude } } },
          { $sample: { size } },
        ]);

  let batch = [];
  if (scope === "contacts") {
    batch = await sample({ $in: contactIds }, limit);
  } else if (scope === "discover") {
    const skip = [...blockedIds, ...contactIds, req.user._id];
    batch = await sample({ $nin: skip }, limit);
  } else {
    const skipOthers = [...blockedIds, ...contactIds];
    const wantKnown = Math.ceil(limit / 2);
    const [known, others] = await Promise.all([
      sample({ $in: [...contactIds, req.user._id] }, wantKnown),
      sample({ $nin: skipOthers }, limit),
    ]);
    // `others` may include my own posts / repeats of `known`; de-dupe, then
    // top up from whichever bucket still has posts so the page stays full.
    const seen = new Set(known.map((p) => String(p._id)));
    const rest = others.filter((p) => !seen.has(String(p._id)) && !contactSet.has(String(p.user)));
    batch = [...known, ...rest].slice(0, limit);
    if (batch.length < limit) {
      const have = new Set(batch.map((p) => String(p._id)));
      const filler = others.filter((p) => !have.has(String(p._id)));
      batch = [...batch, ...filler].slice(0, limit);
    }
  }

  // Fisher-Yates so known/unknown posts are interleaved rather than clumped.
  for (let i = batch.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [batch[i], batch[j]] = [batch[j], batch[i]];
  }

  const populated = await Post.populate(batch, [
    { path: "user", select: AUTHOR_FIELDS },
    { path: "comments.user", select: AUTHOR_FIELDS },
  ]);

  res.json({
    posts: populated.filter((p) => p.user).map((p) => serializePost(p, req.user._id, contactSet)),
    hasMore: batch.length >= limit,
    scope,
  });
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

  emitExplore(req.io, "post:stats", {
    postId: post._id,
    likeCount: post.likes.length,
    commentCount: post.comments.length,
    likerId: req.user._id,
    liked: idx < 0,
  });
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

  emitExplore(req.io, "post:comment", {
    postId: post._id,
    commentCount: post.comments.length,
    comment: { ...comment.toObject(), mine: false },
  });
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
  emitExplore(req.io, "post:comment-deleted", {
    postId: post._id,
    commentId,
    commentCount: post.comments.length,
  });
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
  emitExplore(req.io, "post:deleted", { postId: id, userId: req.user._id });
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
  emitExplore(req.io, "post:updated", { post: broadcastShape(post) });
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
  emitExplore(req.io, "post:comment-updated", {
    postId: post._id,
    commentId,
    text: comment.text,
  });
  res.json({ comment: { _id: comment._id, text: comment.text, edited: true } });
}
