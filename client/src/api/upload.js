import client from "./client";
import { compressMediaItems } from "../utils/imageCompressor";

export async function uploadFiles(files) {
  // Compress images in the file list before uploading
  const compressedFiles = await compressMediaItems(files);

  const formData = new FormData();
  compressedFiles.forEach((f) => {
    const fileObj = f.blob || f.file || f;
    const fileName = f.name || fileObj?.name || "file";
    formData.append("files", fileObj, fileName);
  });

  const res = await client.post("/messages/upload/media", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data.attachments;
}
