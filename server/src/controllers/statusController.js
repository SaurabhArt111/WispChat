import User from "../models/User.js";
import Status from "../models/Status.js";
import { kindFromMime } from "../middleware/upload.js";
import { emitToUsers, audienceOf } from "../utils/realtime.js";

// Tell the owner (all their devices) and everyone who can see their status
// that something changed, so feeds/rings/counts update without a reload.
function notifyStatusChange(req, ownerUser, extra = {}) {
  emitToUsers(req.io, audienceOf(ownerUser), "status:changed", { userId: ownerUser._id, ...extra });
}

// WhatsApp-style cap: at most 5 active (non-expired) slides on your status
// at once. Older ones still expire on their own via the TTL index; this
// just stops the count from growing unbounded before that happens.
const MAX_ACTIVE_STATUSES = 5;

// Whether `viewerId` is allowed to see `owner`'s status, per the owner's
// own Status privacy setting (see StatusPrivacyModal / updateStatusPrivacy).
// The base audience (mutual contacts, or yourself) is always checked by the
// caller first — this only ever narrows that further.
export function canViewStatus(owner, viewerId) {
  if (String(owner._id) === String(viewerId)) return true;
  const privacy = owner.statusPrivacy || { mode: "contacts" };
  if (privacy.mode === "only_share_with") {
    return (privacy.onlyUsers || []).some((id) => String(id) === String(viewerId));
  }
  if (privacy.mode === "contacts_except") {
    return !(privacy.exceptUsers || []).some((id) => String(id) === String(viewerId));
  }
  return true; // "contacts" — already scoped to mutual contacts by the caller
}

// Statuses are visible to your mutual contacts and yourself — same audience
// the rest of the app already uses for "who can see/add you" — further
// narrowed per-owner by that owner's own Status privacy setting.
export async function getFeed(req, res) {
  const user = await req.user.populate("contacts", "_id statusPrivacy");
  const visibleContacts = user.contacts.filter((c) => canViewStatus(c, req.user._id));
  const audience = [req.user._id, ...visibleContacts.map((c) => c._id)];

  const statuses = await Status.find({ user: { $in: audience }, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: 1 })
    .populate("user", "username displayName avatar avatarColor")
    .populate("viewers.user", "username displayName avatar avatarColor")
    .populate("reactions.user", "username displayName avatar avatarColor")
    .lean();

  // Group into one entry per user, each with their ordered slides, so the
  // client can render "My status" + a contact list with unseen/seen rings.
  const byUser = new Map();
  for (const s of statuses) {
    const uid = String(s.user._id);
    if (!byUser.has(uid)) byUser.set(uid, { user: s.user, items: [] });
    byUser.get(uid).items.push({
      _id: s._id,
      kind: s.kind,
      url: s.url,
      mimeType: s.mimeType,
      text: s.text,
      bgColor: s.bgColor,
      caption: s.caption,
      createdAt: s.createdAt,
      // The footer counts people, while each person's row separately shows
      // how many times they viewed this slide.
      viewerCount: new Set(
        (s.viewers || []).map((viewer) => String(viewer.user?._id || viewer.user))
      ).size,
      viewedByMe:
        s.viewers?.some(
          (viewer) => String(viewer.user?._id || viewer.user) === String(req.user._id)
        ) || false,
      viewers: String(s.user._id) === String(req.user._id)
        ? (s.viewers || []).map((viewer) => {
            const reaction = (s.reactions || []).find(
              (entry) => String(entry.user?._id || entry.user) === String(viewer.user?._id || viewer.user)
            );
            return { ...viewer, emoji: viewer.emoji || reaction?.emoji || null };
          })
        : undefined,
      myReaction: String(s.user._id) !== String(req.user._id)
        ? (s.reactions || []).find(
            (reaction) => String(reaction.user?._id || reaction.user) === String(req.user._id)
          )?.emoji || null
        : undefined,
    });
  }

  res.json({ feed: Array.from(byUser.values()) });
}

export async function createStatus(req, res) {
  const { kind, text, bgColor, caption } = req.body;

  const activeCount = await Status.countDocuments({ user: req.user._id, expiresAt: { $gt: new Date() } });
  if (activeCount >= MAX_ACTIVE_STATUSES) {
    return res.status(400).json({
      message: `You can only have ${MAX_ACTIVE_STATUSES} active status updates at once. Delete an old one to post a new one.`,
    });
  }

  if (kind === "text") {
    if (!text?.trim()) return res.status(400).json({ message: "Status text is required" });
    const status = await Status.create({
      user: req.user._id,
      kind: "text",
      text: text.trim(),
      bgColor: bgColor || "#5ef2c0",
    });
    notifyStatusChange(req, req.user, { action: "created" });
    return res.status(201).json({ status });
  }

  const file = req.file;
  if (!file) return res.status(400).json({ message: "Media file is required" });

  const status = await Status.create({
    user: req.user._id,
    kind: kindFromMime(file.mimetype) === "video" ? "video" : "image",
    url: `/uploads/${file.mediaFolder}/${file.filename}`,
    mimeType: file.mimetype,
    caption: (caption || "").trim(),
  });
  notifyStatusChange(req, req.user, { action: "created" });
  res.status(201).json({ status });
}

export async function viewStatus(req, res) {
  const status = await Status.findById(req.params.id).select("_id user viewers");
  if (!status) return res.status(404).json({ message: "Status not found" });

  if (String(status.user) !== String(req.user._id)) {
    const owner = await User.findById(status.user).select("statusPrivacy contacts");
    const isMutualContact = owner?.contacts?.some((id) => String(id) === String(req.user._id));
    if (!owner || !isMutualContact || !canViewStatus(owner, req.user._id)) {
      return res.status(403).json({ message: "You can't view this status" });
    }
    const now = new Date();
    const priorView = status.viewers.find((viewer) => String(viewer.user) === String(req.user._id));
    if (priorView) {
      const update = priorView.count == null
        ? { $set: { "viewers.$.count": 2, "viewers.$.at": now } }
        : { $inc: { "viewers.$.count": 1 }, $set: { "viewers.$.at": now } };
      await Status.updateOne({ _id: status._id, "viewers.user": req.user._id }, update);
    } else {
      const result = await Status.updateOne(
        { _id: status._id, "viewers.user": { $ne: req.user._id } },
        { $push: { viewers: { user: req.user._id, at: now, count: 1 } } }
      );
      // A concurrent first view may have inserted this user after our read.
      if (!result.modifiedCount) {
        await Status.updateOne(
          { _id: status._id, "viewers.user": req.user._id },
          { $inc: { "viewers.$.count": 1 }, $set: { "viewers.$.at": now } }
        );
      }
    }
    // The owner's viewer list / view count updates live.
    emitToUsers(req.io, [status.user], "status:changed", { userId: status.user, action: "viewed" });
  }
  res.json({ ok: true });
}

export async function deleteStatus(req, res) {
  const status = await Status.findById(req.params.id);
  if (!status) return res.status(404).json({ message: "Status not found" });
  if (String(status.user) !== String(req.user._id)) {
    return res.status(403).json({ message: "You can only delete your own status" });
  }
  await status.deleteOne();
  notifyStatusChange(req, req.user, { action: "deleted" });
  res.json({ ok: true });
}

export async function reactToStatus(req, res) {
  const { emoji } = req.body || {};
  if (!emoji || !String(emoji).trim()) {
    return res.status(400).json({ message: "An emoji reaction is required." });
  }

  const status = await Status.findById(req.params.id).select("_id user reactions viewers");
  if (!status) return res.status(404).json({ message: "Status not found" });
  if (String(status.user) === String(req.user._id)) {
    return res.status(403).json({ message: "You can't react to your own status" });
  }

  const owner = await User.findById(status.user).select("statusPrivacy contacts");
  const isMutualContact = owner?.contacts?.some((id) => String(id) === String(req.user._id));
  if (!owner || !isMutualContact || !canViewStatus(owner, req.user._id)) {
    return res.status(403).json({ message: "You can't react to this status" });
  }

  const nextEmoji = String(emoji).trim();
  const existingReaction = status.reactions.find((reaction) => String(reaction.user) === String(req.user._id));
  const now = new Date();

  if (existingReaction) {
    existingReaction.emoji = nextEmoji;
    existingReaction.at = now;
  } else {
    status.reactions.push({ user: req.user._id, emoji: nextEmoji, at: now });
  }

  const viewer = status.viewers.find((entry) => String(entry.user) === String(req.user._id));
  if (viewer) {
    viewer.emoji = nextEmoji;
    viewer.at = now;
  } else {
    status.viewers.push({ user: req.user._id, emoji: nextEmoji, at: now, count: 1 });
  }

  await status.save();
  emitToUsers(req.io, [status.user], "status:changed", { userId: status.user, action: "reacted" });
  res.json({ ok: true, reaction: { user: req.user._id, emoji: nextEmoji, at: now } });
}
