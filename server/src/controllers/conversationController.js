import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import User from "../models/User.js";

// e2ee.publicKeyJwk rides along with every participant so the client can
// build/refresh a conversation's encryption envelope (who to wrap the
// per-message key for) straight from the conversation object, with no
// extra round trip.
const PARTICIPANT_FIELDS = "username displayName avatar avatarColor about isOnline lastSeen e2ee.publicKeyJwk";

async function serializeConversation(conv, userId) {
  const unreadCount = await Message.countDocuments({
    conversation: conv._id,
    sender: { $ne: userId },
    readBy: { $ne: userId },
    deletedFor: { $ne: userId },
  });

  return {
    _id: conv._id,
    isGroup: conv.isGroup,
    name: conv.name,
    description: conv.description,
    avatar: conv.avatar,
    admins: conv.admins,
    createdBy: conv.createdBy,
    onlyAdminsCanMessage: !!conv.onlyAdminsCanMessage,
    participants: conv.participants,
    lastMessage: conv.lastMessage,
    lastMessageAt: conv.lastMessageAt,
    muted: conv.mutedBy?.some((id) => String(id) === String(userId)),
    pinned: conv.pinnedBy?.some((id) => String(id) === String(userId)),
    archived: conv.archivedBy?.some((id) => String(id) === String(userId)),
    unreadCount,
  };
}

export async function listConversations(req, res) {
  const conversations = await Conversation.find({ participants: req.user._id })
    .populate("participants", PARTICIPANT_FIELDS)
    .populate({
      path: "lastMessage",
      select: "text attachments sender createdAt encrypted iv keys deletedForEveryone",
      populate: { path: "sender", select: "displayName username e2ee.publicKeyJwk" },
    })
    .sort({ lastMessageAt: -1 });

  const serialized = await Promise.all(conversations.map((c) => serializeConversation(c, req.user._id)));
  res.json({ conversations: serialized });
}

export async function openDirectConversation(req, res) {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: "userId required" });
  if (userId === String(req.user._id)) return res.status(400).json({ message: "Can't message yourself" });

  const other = await User.findById(userId);
  if (!other) return res.status(404).json({ message: "User not found" });

  let conv = await Conversation.findOne({
    isGroup: false,
    participants: { $all: [req.user._id, userId], $size: 2 },
  }).populate("participants", PARTICIPANT_FIELDS);

  if (!conv) {
    conv = await Conversation.create({
      isGroup: false,
      participants: [req.user._id, userId],
    });
    conv = await conv.populate("participants", PARTICIPANT_FIELDS);
  }

  res.json({ conversation: await serializeConversation(conv, req.user._id) });
}

export async function createGroup(req, res) {
  const { name, participantIds = [], description = "", avatar = "" } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: "Group name required" });

  const uniqueIds = Array.from(new Set([...participantIds, String(req.user._id)]));
  if (uniqueIds.length < 3) return res.status(400).json({ message: "Pick at least 2 other members" });

  let conv = await Conversation.create({
    isGroup: true,
    name: name.trim(),
    description,
    avatar,
    participants: uniqueIds,
    admins: [req.user._id],
    createdBy: req.user._id,
  });
  conv = await conv.populate("participants", PARTICIPANT_FIELDS);

  const io = req.io;
  uniqueIds.forEach((id) => io?.to(`user:${id}`).emit("conversation:new", conv));

  res.status(201).json({ conversation: await serializeConversation(conv, req.user._id) });
}

export async function updateGroup(req, res) {
  const { id } = req.params;
  const conv = await Conversation.findById(id);
  if (!conv || !conv.isGroup) return res.status(404).json({ message: "Group not found" });
  if (!conv.admins.some((a) => String(a) === String(req.user._id))) {
    return res.status(403).json({ message: "Only admins can edit the group" });
  }

  const { name, description, avatar, onlyAdminsCanMessage } = req.body;
  if (name !== undefined) conv.name = name;
  if (description !== undefined) conv.description = description;
  if (avatar !== undefined) conv.avatar = avatar;
  if (onlyAdminsCanMessage !== undefined) conv.onlyAdminsCanMessage = !!onlyAdminsCanMessage;
  await conv.save();

  const populated = await conv.populate("participants", PARTICIPANT_FIELDS);
  req.io?.to(`conversation:${id}`).emit("conversation:updated", populated);
  res.json({ conversation: await serializeConversation(populated, req.user._id) });
}

export async function updateMembers(req, res) {
  const { id } = req.params;
  const { add = [], remove = [] } = req.body;
  const conv = await Conversation.findById(id);
  if (!conv || !conv.isGroup) return res.status(404).json({ message: "Group not found" });
  if (!conv.admins.some((a) => String(a) === String(req.user._id))) {
    return res.status(403).json({ message: "Only admins can manage members" });
  }

  add.forEach((id2) => {
    if (!conv.participants.some((p) => String(p) === id2)) conv.participants.push(id2);
  });
  conv.participants = conv.participants.filter((p) => !remove.includes(String(p)));
  conv.admins = conv.admins.filter((a) => !remove.includes(String(a)));

  await conv.save();
  const populated = await conv.populate("participants", PARTICIPANT_FIELDS);
  req.io?.to(`conversation:${id}`).emit("conversation:updated", populated);
  add.forEach((uid) => req.io?.to(`user:${uid}`).emit("conversation:new", populated));
  res.json({ conversation: await serializeConversation(populated, req.user._id) });
}

// Promote a participant to admin, or demote an existing admin back to a
// regular member. Only current admins may do either. A group can never be
// left with zero admins — the last admin must transfer the role (by
// promoting someone else) before they can be demoted, and demoting is a
// no-op if it would empty the list.
export async function updateAdmins(req, res) {
  const { id } = req.params;
  const { promote = [], demote = [] } = req.body;
  const conv = await Conversation.findById(id);
  if (!conv || !conv.isGroup) return res.status(404).json({ message: "Group not found" });
  if (!conv.admins.some((a) => String(a) === String(req.user._id))) {
    return res.status(403).json({ message: "Only admins can manage admins" });
  }

  const participantIds = new Set(conv.participants.map((p) => String(p)));
  promote.forEach((uid) => {
    if (participantIds.has(String(uid)) && !conv.admins.some((a) => String(a) === String(uid))) {
      conv.admins.push(uid);
    }
  });

  const wouldRemove = new Set(demote.map(String));
  const remainingAdmins = conv.admins.filter((a) => !wouldRemove.has(String(a)));
  if (remainingAdmins.length > 0) {
    conv.admins = remainingAdmins;
  } else if (demote.length > 0) {
    return res.status(400).json({ message: "A group needs at least one admin — promote someone else first" });
  }

  await conv.save();
  const populated = await conv.populate("participants", PARTICIPANT_FIELDS);
  req.io?.to(`conversation:${id}`).emit("conversation:updated", populated);
  res.json({ conversation: await serializeConversation(populated, req.user._id) });
}

export async function toggleConvoFlag(req, res) {
  const { id } = req.params;
  const { flag } = req.body; // 'mute' | 'pin' | 'archive'
  const field = { mute: "mutedBy", pin: "pinnedBy", archive: "archivedBy" }[flag];
  if (!field) return res.status(400).json({ message: "Invalid flag" });

  const conv = await Conversation.findById(id);
  if (!conv) return res.status(404).json({ message: "Not found" });

  const idx = conv[field].findIndex((u) => String(u) === String(req.user._id));
  if (idx >= 0) conv[field].splice(idx, 1);
  else conv[field].push(req.user._id);
  await conv.save();

  res.json({ [flag + "d"]: idx < 0 });
}

export async function clearConversation(req, res) {
  const { id } = req.params;
  await Message.updateMany({ conversation: id }, { $addToSet: { deletedFor: req.user._id } });
  await Conversation.findByIdAndUpdate(id, {
    $pull: { clearedAt: { user: req.user._id } },
  });
  await Conversation.findByIdAndUpdate(id, {
    $push: { clearedAt: { user: req.user._id, at: new Date() } },
  });
  res.json({ ok: true });
}

export async function leaveGroup(req, res) {
  const { id } = req.params;
  const conv = await Conversation.findById(id);
  if (!conv || !conv.isGroup) return res.status(404).json({ message: "Group not found" });

  conv.participants = conv.participants.filter((p) => String(p) !== String(req.user._id));
  conv.admins = conv.admins.filter((a) => String(a) !== String(req.user._id));
  await conv.save();

  req.io?.to(`conversation:${id}`).emit("conversation:member-left", { conversationId: id, userId: req.user._id });
  res.json({ ok: true });
}
