import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import { kindFromMime } from "../middleware/upload.js";

// Recipients need the sender's public key to unwrap the per-message
// encryption key from a message's `keys` envelope, so it rides along
// with every populated sender the same way an avatar does.
const SENDER_FIELDS = "username displayName avatar avatarColor e2ee.publicKeyJwk";

const REPLY_SELECT = "text attachments sender deletedForEveryone encrypted iv keys";

async function populateMessage(msg) {
  return msg.populate([
    { path: "sender", select: SENDER_FIELDS },
    { path: "forwardedFrom", select: SENDER_FIELDS },
    {
      path: "replyTo",
      select: REPLY_SELECT,
      populate: { path: "sender", select: SENDER_FIELDS },
    },
    { path: "reactions.user", select: "username displayName" },
  ]);
}

export async function getMessages(req, res) {
  const { conversationId } = req.params;
  const { before, limit = 30 } = req.query;

  const conv = await Conversation.findById(conversationId);
  if (!conv || !conv.participants.some((p) => String(p) === String(req.user._id))) {
    return res.status(403).json({ message: "Not a participant" });
  }

  const query = { conversation: conversationId, deletedFor: { $ne: req.user._id } };
  if (before) query.createdAt = { $lt: new Date(before) };

  const messages = await Message.find(query)
    .sort({ createdAt: -1 })
    .limit(Number(limit))
    .populate([
      { path: "sender", select: SENDER_FIELDS },
      { path: "forwardedFrom", select: SENDER_FIELDS },
      {
        path: "replyTo",
        select: REPLY_SELECT,
        populate: { path: "sender", select: SENDER_FIELDS },
      },
      { path: "reactions.user", select: "username displayName" },
    ]);

  res.json({ messages: messages.reverse(), hasMore: messages.length === Number(limit) });
}

export async function sendMessage(req, res) {
  const { conversationId } = req.params;
  const { text = "", replyTo = null, clientId, attachments = [], encrypted = false, iv = null, keys = [] } = req.body;

  const conv = await Conversation.findById(conversationId);
  if (!conv || !conv.participants.some((p) => String(p) === String(req.user._id))) {
    return res.status(403).json({ message: "Not a participant" });
  }
  // Ciphertext isn't ".trim()"-empty-checkable the way plaintext is, so an
  // encrypted send is considered non-empty as long as it carries a key
  // envelope (the client already refused to build one for a truly empty
  // message).
  if (!encrypted && !text.trim() && attachments.length === 0) {
    return res.status(400).json({ message: "Empty message" });
  }
  if (encrypted && !text && attachments.length === 0) {
    return res.status(400).json({ message: "Empty message" });
  }

  let msg = await Message.create({
    conversation: conversationId,
    sender: req.user._id,
    text: encrypted ? text : text.trim(),
    attachments,
    encrypted,
    iv,
    keys,
    replyTo: replyTo || null,
    clientId,
    deliveredTo: [req.user._id],
    readBy: [req.user._id],
  });
  msg = await populateMessage(msg);

  conv.lastMessage = msg._id;
  conv.lastMessageAt = new Date();
  await conv.save();

  const io = req.io;
  conv.participants.forEach((uid) => io?.to(`user:${uid}`).emit("message:new", msg));

  res.status(201).json({ message: msg });
}

export async function uploadMedia(req, res) {
  const files = req.files || [];

  // "Send as document" bypasses compression client-side and asks us to
  // keep every file as a plain downloadable attachment instead of an
  // inline image/video/audio bubble, regardless of its real mimetype.
  const asDocument = req.body.asDocument === "true" || req.body.asDocument === true;

  // Per-file encryption metadata rides alongside the files as a JSON array
  // (aligned by upload order) — each entry is either null (not encrypted)
  // or { iv } for a file whose bytes are AES-GCM ciphertext. The mimetype
  // on the multipart part itself is deliberately left as the *original*
  // mimetype (image/jpeg, video/mp4, ...) even when encrypted, purely so
  // folderForFile/kindFromMime keep sorting things sensibly on disk — the
  // server never decrypts or inspects the actual bytes either way.
  let encMeta = [];
  try {
    encMeta = req.body.encMeta ? JSON.parse(req.body.encMeta) : [];
  } catch {
    encMeta = [];
  }

  const attachments = files.map((f, i) => {
    const meta = encMeta[i] || null;
    return {
      // f.mediaFolder is set by the upload middleware's diskStorage.destination
      // so the URL always matches the folder the file actually landed in
      // (images/, videos/, audio/, documents/, gifs/, stickers/).
      url: `/uploads/${f.mediaFolder}/${f.filename}`,
      name: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
      kind: asDocument ? "file" : kindFromMime(f.mimetype),
      asDocument,
      encrypted: !!meta,
      iv: meta?.iv || null,
    };
  });
  res.json({ attachments });
}

// Powers the "Media & Storage" breakdown chart in ProfileModal: how many
// attachments of each kind (image/video/audio/file) the user has sent or
// received across every conversation they're part of, and how much space
// they take up — a direct reflection of the images/videos/audio/documents/
// gifs folder split the upload middleware now sorts files into on disk.
export async function getMediaStats(req, res) {
  const conversations = await Conversation.find({ participants: req.user._id }, "_id");
  const conversationIds = conversations.map((c) => c._id);

  const stats = await Message.aggregate([
    { $match: { conversation: { $in: conversationIds }, deletedForEveryone: { $ne: true } } },
    { $unwind: "$attachments" },
    {
      $group: {
        _id: "$attachments.kind",
        count: { $sum: 1 },
        totalBytes: { $sum: { $ifNull: ["$attachments.size", 0] } },
      },
    },
  ]);

  const byKind = { image: 0, video: 0, audio: 0, file: 0 };
  const bytesByKind = { image: 0, video: 0, audio: 0, file: 0 };
  for (const row of stats) {
    if (row._id in byKind) {
      byKind[row._id] = row.count;
      bytesByKind[row._id] = row.totalBytes;
    }
  }

  res.json({
    counts: byKind,
    bytes: bytesByKind,
    totalCount: Object.values(byKind).reduce((a, b) => a + b, 0),
    totalBytes: Object.values(bytesByKind).reduce((a, b) => a + b, 0),
  });
}

// Powers the actual media *gallery* in the Media & Storage rail panel —
// getMediaStats above only returns counts, this returns the real
// attachment items (most recent first), across every conversation the
// user is in, regardless of who sent them — "shared" and "received" both.
export async function getMediaList(req, res) {
  const kind = ["image", "video", "audio", "file"].includes(req.query.kind) ? req.query.kind : "image";
  const limit = Math.min(100, Number(req.query.limit) || 60);

  const conversations = await Conversation.find({ participants: req.user._id }, "_id");
  const conversationIds = conversations.map((c) => c._id);

  const messages = await Message.find({
    conversation: { $in: conversationIds },
    deletedForEveryone: { $ne: true },
    "attachments.kind": kind,
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("sender", "displayName username avatar avatarColor e2ee.publicKeyJwk")
    .select("attachments sender conversation createdAt encrypted iv keys")
    .lean();

  const items = [];
  for (const m of messages) {
    for (const a of m.attachments || []) {
      if (a.kind !== kind) continue;
      items.push({
        ...a,
        messageId: m._id,
        conversationId: m.conversation,
        // Carried along so the client can decrypt this attachment the
        // same way it would inside the chat itself — the gallery isn't a
        // separate, unencrypted copy of anything, it's just a different
        // view over the same messages.
        messageEncrypted: m.encrypted,
        messageIv: m.iv,
        messageKeys: m.keys,
        sender: m.sender,
        createdAt: m.createdAt,
      });
    }
  }

  res.json({ items: items.slice(0, limit) });
}

export async function editMessage(req, res) {
  const { id } = req.params;
  const { text, encrypted, iv, keys } = req.body;

  const msg = await Message.findById(id);
  if (!msg) return res.status(404).json({ message: "Message not found" });
  if (String(msg.sender) !== String(req.user._id)) return res.status(403).json({ message: "Not your message" });
  if (msg.deletedForEveryone) return res.status(400).json({ message: "Message was deleted" });

  msg.text = text;
  // An edit to an encrypted message is re-encrypted client-side with a
  // fresh per-message key and a brand new envelope, same as an original
  // send — the old envelope is simply replaced.
  if (encrypted !== undefined) msg.encrypted = encrypted;
  if (iv !== undefined) msg.iv = iv;
  if (keys !== undefined) msg.keys = keys;
  msg.edited = true;
  msg.editedAt = new Date();
  await msg.save();
  const populated = await populateMessage(msg);

  const conv = await Conversation.findById(msg.conversation);
  conv.participants.forEach((uid) => req.io?.to(`user:${uid}`).emit("message:edited", populated));

  res.json({ message: populated });
}

export async function deleteMessage(req, res) {
  const { id } = req.params;
  const { forEveryone } = req.body;

  const msg = await Message.findById(id);
  if (!msg) return res.status(404).json({ message: "Message not found" });

  const conv = await Conversation.findById(msg.conversation);

  if (forEveryone) {
    if (String(msg.sender) !== String(req.user._id)) {
      return res.status(403).json({ message: "Only sender can delete for everyone" });
    }
    msg.deletedForEveryone = true;
    msg.text = "";
    msg.attachments = [];
    await msg.save();
    conv.participants.forEach((uid) =>
      req.io?.to(`user:${uid}`).emit("message:deleted", { id, forEveryone: true })
    );
  } else {
    msg.deletedFor.addToSet(req.user._id);
    await msg.save();
    req.io?.to(`user:${req.user._id}`).emit("message:deleted", { id, forEveryone: false });
  }

  res.json({ ok: true });
}

export async function reactToMessage(req, res) {
  const { id } = req.params;
  const { emoji } = req.body;

  const msg = await Message.findById(id);
  if (!msg) return res.status(404).json({ message: "Message not found" });

  const existingIdx = msg.reactions.findIndex((r) => String(r.user) === String(req.user._id));
  if (existingIdx >= 0 && msg.reactions[existingIdx].emoji === emoji) {
    msg.reactions.splice(existingIdx, 1); // toggle off
  } else if (existingIdx >= 0) {
    msg.reactions[existingIdx].emoji = emoji;
  } else {
    msg.reactions.push({ user: req.user._id, emoji });
  }
  await msg.save();
  const populated = await populateMessage(msg);

  const conv = await Conversation.findById(msg.conversation);
  conv.participants.forEach((uid) => req.io?.to(`user:${uid}`).emit("message:reaction", populated));

  res.json({ message: populated });
}

export async function forwardMessage(req, res) {
  const { id } = req.params;
  const { conversationIds = [], items = [] } = req.body;

  const original = await Message.findById(id);
  if (!original) return res.status(404).json({ message: "Message not found" });

  // Because an encrypted message's key envelope is scoped to its original
  // conversation's participants, the server can't just copy its ciphertext
  // into a different conversation. So when forwarding an *encrypted*
  // message, the client decrypts it locally first and re-encrypts a fresh
  // copy per destination (via `items`), the same way a brand new message
  // is composed. Plain (unencrypted) messages can still take the simple
  // `conversationIds` shortcut below.
  const results = [];

  for (const item of items) {
    const conv = await Conversation.findById(item.conversationId);
    if (!conv || !conv.participants.some((p) => String(p) === String(req.user._id))) continue;

    let msg = await Message.create({
      conversation: item.conversationId,
      sender: req.user._id,
      text: item.text ?? "",
      attachments: item.attachments || [],
      encrypted: !!item.encrypted,
      iv: item.iv || null,
      keys: item.keys || [],
      forwardedFrom: original.sender,
      deliveredTo: [req.user._id],
      readBy: [req.user._id],
    });
    msg = await populateMessage(msg);

    conv.lastMessage = msg._id;
    conv.lastMessageAt = new Date();
    await conv.save();

    conv.participants.forEach((uid) => req.io?.to(`user:${uid}`).emit("message:new", msg));
    results.push(msg);
  }

  for (const convId of conversationIds) {
    const conv = await Conversation.findById(convId);
    if (!conv || !conv.participants.some((p) => String(p) === String(req.user._id))) continue;
    if (original.encrypted) continue; // must go through `items` above

    let msg = await Message.create({
      conversation: convId,
      sender: req.user._id,
      text: original.text,
      attachments: original.attachments,
      forwardedFrom: original.sender,
      deliveredTo: [req.user._id],
      readBy: [req.user._id],
    });
    msg = await populateMessage(msg);

    conv.lastMessage = msg._id;
    conv.lastMessageAt = new Date();
    await conv.save();

    conv.participants.forEach((uid) => req.io?.to(`user:${uid}`).emit("message:new", msg));
    results.push(msg);
  }

  res.json({ messages: results });
}

export async function markRead(req, res) {
  const { conversationId } = req.params;

  const result = await Message.updateMany(
    { conversation: conversationId, readBy: { $ne: req.user._id } },
    { $addToSet: { readBy: req.user._id, deliveredTo: req.user._id } }
  );

  const conv = await Conversation.findById(conversationId);
  conv?.participants.forEach((uid) =>
    req.io?.to(`user:${uid}`).emit("message:read", { conversationId, userId: req.user._id })
  );

  res.json({ ok: true, modified: result.modifiedCount });
}
