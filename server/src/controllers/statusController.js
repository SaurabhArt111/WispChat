import Status from "../models/Status.js";
import { kindFromMime } from "../middleware/upload.js";

// Statuses are visible to your mutual contacts and yourself — same audience
// the rest of the app already uses for "who can see/add you".
export async function getFeed(req, res) {
  const user = await req.user.populate("contacts", "_id");
  const audience = [req.user._id, ...user.contacts.map((c) => c._id)];

  const statuses = await Status.find({ user: { $in: audience }, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: 1 })
    .populate("user", "username displayName avatar avatarColor")
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
      viewerCount: s.viewers?.length || 0,
      viewedByMe: s.viewers?.some((v) => String(v.user) === String(req.user._id)) || false,
      viewers: String(s.user._id) === String(req.user._id) ? s.viewers : undefined,
    });
  }

  res.json({ feed: Array.from(byUser.values()) });
}

export async function createStatus(req, res) {
  const { kind, text, bgColor, caption } = req.body;

  if (kind === "text") {
    if (!text?.trim()) return res.status(400).json({ message: "Status text is required" });
    const status = await Status.create({
      user: req.user._id,
      kind: "text",
      text: text.trim(),
      bgColor: bgColor || "#5ef2c0",
    });
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
  res.status(201).json({ status });
}

export async function viewStatus(req, res) {
  const status = await Status.findById(req.params.id);
  if (!status) return res.status(404).json({ message: "Status not found" });

  const already = status.viewers.some((v) => String(v.user) === String(req.user._id));
  if (!already && String(status.user) !== String(req.user._id)) {
    status.viewers.push({ user: req.user._id, at: new Date() });
    await status.save();
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
  res.json({ ok: true });
}
