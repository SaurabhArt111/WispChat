import mongoose from "mongoose";
import User from "../models/User.js";
import FriendRequest from "../models/FriendRequest.js";
import Post from "../models/Post.js";
import Conversation from "../models/Conversation.js";
import { emitToUsers, audienceOf } from "../utils/realtime.js";

// Backs both the "New chat" people picker and the Explorer search bar —
// matches by @username, display name, email, or (if the query happens to
// be a valid Mongo id) the raw user ID itself, the same way Instagram lets
// you paste someone's handle *or* find them by name.
export async function searchUsers(req, res) {
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ users: [] });

  const or = [
    { username: new RegExp(q.replace(/^@/, ""), "i") },
    { displayName: new RegExp(q, "i") },
    { email: new RegExp(q, "i") },
  ];
  if (mongoose.Types.ObjectId.isValid(q)) or.push({ _id: q });

  const users = await User.find({ _id: { $ne: req.user._id }, $or: or })
    .limit(20)
    .select("username displayName avatar avatarColor about isOnline lastSeen e2ee.publicKeyJwk");

  res.json({ users });
}

const PUBLIC_FIELDS = "username displayName avatar avatarColor about isOnline lastSeen";

// Powers the "New chat" page's discovery sections:
//  • likedAuthors — people whose Explorer posts *you* liked (contacts or not)
//  • suggested    — people you may know: non-contacts ranked by mutual
//                   contacts, then padded with the newest accounts.
// Anyone blocked in either direction, already a contact, or with a pending
// request is left out of `suggested` (still shown in likedAuthors, flagged
// with isContact / requestPending so the UI can offer the right action).
export async function getSuggestions(req, res) {
  const me = req.user;
  const myId = me._id;

  const [blockedMe, pending, likedAgg] = await Promise.all([
    User.find({ blocked: myId }, "_id").lean(),
    FriendRequest.find({ status: "pending", $or: [{ from: myId }, { to: myId }] }).lean(),
    Post.aggregate([
      { $match: { likes: myId, user: { $ne: myId } } },
      { $group: { _id: "$user", likedCount: { $sum: 1 }, lastAt: { $max: "$updatedAt" } } },
      { $sort: { lastAt: -1 } },
      { $limit: 30 },
    ]),
  ]);

  const blockedIds = new Set([...(me.blocked || []), ...blockedMe.map((u) => u._id)].map(String));
  const contactIds = new Set((me.contacts || []).map(String));
  const pendingIds = new Set(pending.map((r) => String(String(r.from) === String(myId) ? r.to : r.from)));

  // People whose posts I liked
  const likedIds = likedAgg.map((a) => a._id).filter((id) => !blockedIds.has(String(id)));
  const likedUsers = await User.find({ _id: { $in: likedIds } }).select(PUBLIC_FIELDS).lean();
  const likedById = new Map(likedUsers.map((u) => [String(u._id), u]));
  const likedAuthors = likedAgg
    .map((a) => {
      const u = likedById.get(String(a._id));
      if (!u) return null;
      return {
        ...u,
        likedCount: a.likedCount,
        isContact: contactIds.has(String(u._id)),
        requestPending: pendingIds.has(String(u._id)),
      };
    })
    .filter(Boolean);

  // People you may know
  const skip = new Set([String(myId), ...blockedIds, ...contactIds, ...pendingIds, ...likedIds.map(String)]);
  const skipObjectIds = [...skip].map((id) => new mongoose.Types.ObjectId(id));
  const myContacts = me.contacts || [];

  const mutual = myContacts.length
    ? await User.aggregate([
        { $match: { _id: { $nin: skipObjectIds }, contacts: { $in: myContacts } } },
        { $addFields: { mutualCount: { $size: { $setIntersection: ["$contacts", myContacts] } } } },
        { $sort: { mutualCount: -1 } },
        { $limit: 20 },
        { $project: { username: 1, displayName: 1, avatar: 1, avatarColor: 1, about: 1, isOnline: 1, lastSeen: 1, mutualCount: 1 } },
      ])
    : [];

  const taken = new Set([...skip, ...mutual.map((u) => String(u._id))]);
  const newest = await User.find({ _id: { $nin: [...taken].map((id) => new mongoose.Types.ObjectId(id)) } })
    .sort({ createdAt: -1 })
    .limit(Math.max(0, 20 - mutual.length))
    .select(PUBLIC_FIELDS)
    .lean();

  const suggested = [
    ...mutual.map((u) => ({ ...u, reason: `${u.mutualCount} mutual contact${u.mutualCount > 1 ? "s" : ""}` })),
    ...newest.map((u) => ({ ...u, reason: "New on Wisp" })),
  ];

  res.json({ likedAuthors, suggested });
}

// Powers Settings/Status > "Status privacy" (see StatusPrivacyModal). `mode`
// is one of contacts / contacts_except / only_share_with; the matching list
// (exceptUsers / onlyUsers) is only meaningful for the latter two modes, but
// both are always stored so switching modes doesn't lose the other list.
export async function updateStatusPrivacy(req, res) {
  const { mode, exceptUsers, onlyUsers } = req.body;
  if (mode && !["contacts", "contacts_except", "only_share_with"].includes(mode)) {
    return res.status(400).json({ message: "Invalid privacy mode" });
  }
  req.user.statusPrivacy = req.user.statusPrivacy || {};
  if (mode !== undefined) req.user.statusPrivacy.mode = mode;
  if (Array.isArray(exceptUsers)) req.user.statusPrivacy.exceptUsers = exceptUsers;
  if (Array.isArray(onlyUsers)) req.user.statusPrivacy.onlyUsers = onlyUsers;
  await req.user.save();
  // Other devices of this account pick up the new privacy settings, and
  // contacts re-check whose statuses they're allowed to see.
  emitToUsers(req.io, [req.user._id], "me:updated", { user: req.user.toPrivateJSON() });
  emitToUsers(req.io, audienceOf(req.user), "status:changed", { userId: req.user._id, action: "privacy" });
  res.json({ user: req.user.toPrivateJSON() });
}

export async function updateProfile(req, res) {
  const { displayName, about, avatar, avatarColor } = req.body;
  if (displayName !== undefined) req.user.displayName = displayName;
  if (about !== undefined) req.user.about = about;
  if (avatar !== undefined) req.user.avatar = avatar;
  if (avatarColor !== undefined) req.user.avatarColor = avatarColor;
  await req.user.save();

  // Everyone who can see this profile — contacts plus anyone sharing a chat
  // (e.g. group members who aren't contacts) — gets the new name/photo/about
  // immediately instead of after their next reload.
  const convs = await Conversation.find({ participants: req.user._id }).select("participants").lean();
  const audience = new Set(audienceOf(req.user).map(String));
  convs.forEach((c) => c.participants.forEach((p) => audience.add(String(p))));
  const safe = req.user.toSafeJSON();
  emitToUsers(req.io, [...audience], "user:updated", {
    user: {
      _id: safe._id,
      username: safe.username,
      displayName: safe.displayName,
      avatar: safe.avatar,
      avatarColor: safe.avatarColor,
      about: safe.about,
    },
  });
  emitToUsers(req.io, [req.user._id], "me:updated", { user: req.user.toPrivateJSON() });
  res.json({ user: safe });
}

export async function getContacts(req, res) {
  const user = await req.user.populate(
    "contacts",
    "username displayName avatar avatarColor about isOnline lastSeen e2ee.publicKeyJwk"
  );
  res.json({ contacts: user.contacts });
}

export async function sendFriendRequest(req, res) {
  const { userId } = req.body;
  if (userId === String(req.user._id)) return res.status(400).json({ message: "Can't add yourself" });

  const target = await User.findById(userId);
  if (!target) return res.status(404).json({ message: "User not found" });

  if (req.user.contacts.includes(userId)) {
    return res.status(400).json({ message: "Already in contacts" });
  }

  const existing = await FriendRequest.findOne({
    $or: [
      { from: req.user._id, to: userId },
      { from: userId, to: req.user._id },
    ],
    status: "pending",
  });
  if (existing) return res.status(400).json({ message: "Request already pending" });

  const request = await FriendRequest.create({ from: req.user._id, to: userId, status: "pending" });
  const populated = await request.populate("from", "username displayName avatar avatarColor");

  req.io?.to(`user:${userId}`).emit("friend-request:new", populated);
  // The sender's other devices refresh their "Sent" list too.
  emitToUsers(req.io, [req.user._id], "friend-request:changed", { requestId: request._id });
  res.status(201).json({ request: populated });
}

export async function listFriendRequests(req, res) {
  const incoming = await FriendRequest.find({ to: req.user._id, status: "pending" }).populate(
    "from",
    "username displayName avatar avatarColor about"
  );
  const outgoing = await FriendRequest.find({ from: req.user._id, status: "pending" }).populate(
    "to",
    "username displayName avatar avatarColor about"
  );
  res.json({ incoming, outgoing });
}

export async function respondFriendRequest(req, res) {
  const { requestId } = req.params;
  const { accept } = req.body;

  const request = await FriendRequest.findById(requestId);
  if (!request || String(request.to) !== String(req.user._id)) {
    return res.status(404).json({ message: "Request not found" });
  }

  request.status = accept ? "accepted" : "declined";
  await request.save();

  if (accept) {
    await User.findByIdAndUpdate(request.from, { $addToSet: { contacts: request.to } });
    await User.findByIdAndUpdate(request.to, { $addToSet: { contacts: request.from } });
  }

  req.io?.to(`user:${request.from}`).emit("friend-request:resolved", { requestId, accept });
  // Both people (all devices) refresh their contact lists, request counts
  // and status feeds — accepting changes who can see what.
  emitToUsers(req.io, [request.from, request.to], "contacts:changed", { requestId, accept });
  emitToUsers(req.io, [request.from, request.to], "friend-request:changed", { requestId });
  if (accept) emitToUsers(req.io, [request.from, request.to], "status:changed", { action: "contacts" });
  res.json({ ok: true });
}

export async function toggleBlock(req, res) {
  const { userId } = req.params;
  const idx = req.user.blocked.findIndex((id) => String(id) === userId);
  if (idx >= 0) req.user.blocked.splice(idx, 1);
  else req.user.blocked.push(userId);
  await req.user.save();
  emitToUsers(req.io, [req.user._id, userId], "contacts:changed", { blocked: true });
  res.json({ blocked: req.user.blocked });
}

// Powers Settings > Privacy > Blocked contacts — the toggleBlock endpoint
// above only ever returns raw ids, which isn't enough to render a list
// with names/avatars/an unblock button.
export async function getBlockedContacts(req, res) {
  const populated = await req.user.populate("blocked", "username displayName avatar avatarColor");
  res.json({ blocked: populated.blocked });
}
