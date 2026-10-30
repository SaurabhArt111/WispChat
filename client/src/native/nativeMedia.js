// ---------------------------------------------------------------------------
// Keeps a copy of chat media in the WispChat folder on the phone
// (Android/media/com.wispchat.app/WispChat/Media/…), like WhatsApp does.
// ---------------------------------------------------------------------------
import { native, isNative } from "./wispNative";
import { mediaUrl } from "../api/config";

const AUTO_KEY = "wisp_autosave_media";
const AUTO_SAVE_MAX_BYTES = 50 * 1024 * 1024; // bigger files are saved only when the person taps Save
const CHUNK_BYTES = 384 * 1024; // multiple of 3 → every chunk is clean base64

export const isAutoSaveOn = () => localStorage.getItem(AUTO_KEY) !== "false";
export const setAutoSave = (on) => localStorage.setItem(AUTO_KEY, String(!!on));

const inFlight = new Map(); // key -> Promise<path|null>
const done = new Set(); // keys saved this session

/** image | video | audio | voice | gif | file → the folder it belongs in. */
export function folderKind(a) {
  if (!a) return "file";
  if (a.asDocument) return "file";
  if (a.kind === "image") return /gif/i.test(a.mimeType || "") ? "gif" : "image";
  if (a.kind === "video") return "video";
  if (a.kind === "audio") return /^(voice|ptt|recording)/i.test(a.name || "") ? "voice" : "audio";
  return "file";
}

function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function saveBlob(key, blob, meta) {
  let offset = 0;
  let path = null;
  do {
    const chunk = new Uint8Array(await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
    const first = offset === 0;
    const last = offset + CHUNK_BYTES >= blob.size;
    const r = await native.saveFileChunk({ key, ...meta, data: toBase64(chunk), first, last });
    if (!r) return null; // native refused / failed
    if (r.skipped) return r.path; // already in the folder
    if (r.path) path = r.path;
    offset += CHUNK_BYTES;
  } while (offset < blob.size);
  return path;
}

/**
 * Save one attachment. Pass `blob` for decrypted (E2EE) media, or nothing to
 * let Android download the public URL itself (no bytes cross the JS bridge).
 * `auto` = triggered by simply viewing it → respects the setting and size cap.
 */
export function saveAttachment(attachment, { blob, sent = false, auto = false } = {}) {
  if (!isNative || !attachment?.url) return Promise.resolve(null);
  const key = `${attachment.url}`;
  if (auto) {
    if (!isAutoSaveOn() || done.has(key)) return Promise.resolve(null);
    if (attachment.size && attachment.size > AUTO_SAVE_MAX_BYTES) return Promise.resolve(null);
    if (folderKind(attachment) === "file") return Promise.resolve(null); // documents: only on request
  }
  if (inFlight.has(key)) return inFlight.get(key);

  const meta = {
    kind: folderKind(attachment),
    sent: !!sent,
    name: attachment.name || "",
    mime: attachment.mimeType || blob?.type || "",
  };
  const job = (async () => {
    try {
      const path = blob ? await saveBlob(key, blob, meta) : (await native.saveFromUrl({ url: mediaUrl(attachment.url), key, ...meta }))?.path || null;
      if (path) done.add(key);
      return path;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, job);
  return job;
}

/**
 * Replaces `<a download>` (which does nothing inside an Android WebView).
 * Returns true when the native app handled it.
 */
export async function nativeDownload({ url, blobUrl, name, mimeType, kind }, toast) {
  if (!isNative) return false;
  const attachment = { url: url || blobUrl, name, mimeType, kind: kind || "file", asDocument: kind === "file" };
  try {
    let path;
    if (blobUrl || (url && url.startsWith("blob:"))) {
      const blob = await (await fetch(blobUrl || url)).blob();
      path = await saveBlob(attachment.url, blob, { kind: folderKind(attachment), sent: false, name: name || "", mime: mimeType || blob.type });
    } else {
      path = (await native.saveFromUrl({ url: mediaUrl(url), key: url, kind: folderKind(attachment), sent: false, name: name || "", mime: mimeType || "" }))?.path;
    }
    if (path) toast?.(`Saved to ${path.split("/WispChat/")[1] ? `WispChat/${path.split("/WispChat/")[1]}` : path}`);
    else toast?.("Couldn't save the file", "danger");
    return true;
  } catch {
    toast?.("Couldn't save the file", "danger");
    return true;
  }
}
