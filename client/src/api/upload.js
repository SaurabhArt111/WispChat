import client from "./client";
import { encryptBytesWithKey } from "../utils/crypto";

/**
 * Uploads already-prepared File/Blob objects as-is (no compression, no
 * encryption decisions here — that's all done by the caller). Used both
 * by the normal send path (after compressing + encrypting) and by
 * message forwarding (after decrypting the original and re-encrypting
 * fresh copies for the destination conversation).
 */
export async function uploadPreparedFiles(preparedFiles, { asDocument = false, onUploadProgress } = {}) {
  if (!preparedFiles.length) return [];
  const formData = new FormData();
  const encMeta = [];
  preparedFiles.forEach((f) => {
    formData.append("files", f.blob, f.name);
    encMeta.push(f.encrypted ? { iv: f.iv } : null);
  });
  formData.append("encMeta", JSON.stringify(encMeta));
  formData.append("asDocument", asDocument ? "true" : "false");

  const res = await client.post("/messages/upload/media", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: onUploadProgress
      ? (evt) => onUploadProgress(evt.total ? evt.loaded / evt.total : 0)
      : undefined,
  });
  return res.data.attachments;
}

/**
 * Main entry point used when sending media from the composer/status
 * editor. `items` are already-compressed (or, in document mode,
 * untouched) File/Blob objects. When `envelope.canEncrypt` is set (every
 * participant in the conversation has encryption keys), each file's bytes
 * are AES-GCM encrypted client-side with the message's shared key before
 * upload — the server only ever receives and stores ciphertext.
 */
export async function uploadFiles(items, { envelope, asDocument = false, onUploadProgress } = {}) {
  const prepared = await Promise.all(
    items.map(async (item) => {
      const fileObj = item.blob || item.file || item;
      const name = item.name || fileObj.name || "file";
      const mimeType = fileObj.type || "application/octet-stream";

      if (envelope?.canEncrypt) {
        const buffer = await fileObj.arrayBuffer();
        const { ciphertext, iv } = await encryptBytesWithKey(envelope.mk, buffer);
        const blob = new Blob([ciphertext], { type: mimeType });
        return { blob, name, mimeType, encrypted: true, iv };
      }
      return { blob: fileObj, name, mimeType, encrypted: false, iv: null };
    })
  );
  return uploadPreparedFiles(prepared, { asDocument, onUploadProgress });
}
