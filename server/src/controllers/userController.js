import User from "../models/User.js";
import FriendRequest from "../models/FriendRequest.js";

export async function searchUsers(req, res) {
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ users: [] });

  const users = await User.find({
    _id: { $ne: req.user._id },
    $or: [
      { username: new RegExp(q, "i") },
      { displayName: new RegExp(q, "i") },
      { email: new RegExp(q, "i") },
    ],
  })
    .limit(20)
    .select("username displayName avatar avatarColor about isOnline lastSeen");

  res.json({ users });
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
  const user = await req.user.populate("contacts", "username displayName avatar avatarColor about isOnline lastSeen");
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
