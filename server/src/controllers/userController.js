import mongoose from "mongoose";
import User from "../models/User.js";
import FriendRequest from "../models/FriendRequest.js";

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
  res.json({ user: req.user.toPrivateJSON() });
}

export async function updateProfile(req, res) {
  const { displayName, about, avatar, avatarColor } = req.body;
  if (displayName !== undefined) req.user.displayName = displayName;
  if (about !== undefined) req.user.about = about;
  if (avatar !== undefined) req.user.avatar = avatar;
  if (avatarColor !== undefined) req.user.avatarColor = avatarColor;
  await req.user.save();
  res.json({ user: req.user.toSafeJSON() });
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
  res.json({ ok: true });
}

export async function toggleBlock(req, res) {
  const { userId } = req.params;
  const idx = req.user.blocked.findIndex((id) => String(id) === userId);
  if (idx >= 0) req.user.blocked.splice(idx, 1);
  else req.user.blocked.push(userId);
  await req.user.save();
  res.json({ blocked: req.user.blocked });
}

// Powers Settings > Privacy > Blocked contacts — the toggleBlock endpoint
// above only ever returns raw ids, which isn't enough to render a list
// with names/avatars/an unblock button.
export async function getBlockedContacts(req, res) {
  const populated = await req.user.populate("blocked", "username displayName avatar avatarColor");
  res.json({ blocked: populated.blocked });
}
