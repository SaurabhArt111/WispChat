import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

// Media library structure: instead of dumping every upload flat into
// /uploads, files are sorted into type-specific subfolders. This keeps the
// directory browsable/backupable at scale and mirrors how most chat apps
// (WhatsApp, Telegram, etc.) lay out their media store on disk.
export const MEDIA_FOLDERS = {
  IMAGES: "images",
  VIDEOS: "videos",
  AUDIO: "audio",
  DOCUMENTS: "documents",
  GIFS: "gifs",
  STICKERS: "stickers",
  PROFILE_PHOTOS: "profile-photos",
};

// Pre-create every folder up front so the tree is predictable even before
// the first upload of a given type lands.
for (const folder of Object.values(MEDIA_FOLDERS)) {
  const dir = path.join(UPLOAD_DIR, folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const STICKER_MIME_HINT = /sticker/i;

// Decides which subfolder a file belongs in, based on mimetype first and
// filename extension as a fallback for the octet-stream files some
// browsers/OSes send for less common formats.
export function folderForFile(mimetype = "", originalname = "") {
  const mime = mimetype.toLowerCase();
  const ext = path.extname(originalname).toLowerCase();

  if (STICKER_MIME_HINT.test(mime) || STICKER_MIME_HINT.test(originalname)) {
    return MEDIA_FOLDERS.STICKERS;
  }
  if (mime === "image/gif" || ext === ".gif") return MEDIA_FOLDERS.GIFS;
  if (mime === "image/webp" && /sticker/i.test(originalname)) return MEDIA_FOLDERS.STICKERS;
  if (mime.startsWith("image/")) return MEDIA_FOLDERS.IMAGES;
  if (mime.startsWith("video/")) return MEDIA_FOLDERS.VIDEOS;
  if (mime.startsWith("audio/")) return MEDIA_FOLDERS.AUDIO;
  return MEDIA_FOLDERS.DOCUMENTS;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = folderForFile(file.mimetype, file.originalname);
    const dir = path.join(UPLOAD_DIR, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Stash it on the file object so the controller can build the right
    // public URL without re-deriving the folder from the mimetype again.
    file.mediaFolder = folder;
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const id = crypto.randomBytes(12).toString("hex");
    cb(null, `${Date.now()}-${id}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024, files: 10 },
});

// Avatar-specific uploader (kept separate so profile photos always land in
// their own folder regardless of how the generic media uploader evolves).
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(UPLOAD_DIR, MEDIA_FOLDERS.PROFILE_PHOTOS)),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    const id = crypto.randomBytes(12).toString("hex");
    cb(null, `${Date.now()}-${id}${ext}`);
  },
});

export const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

export function kindFromMime(mime = "") {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}
