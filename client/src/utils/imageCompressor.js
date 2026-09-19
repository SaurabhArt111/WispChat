/**
 * Intelligent client-side image compressor
 * Scales large photos to max 1920px and compresses JPEG/PNG/WebP to ~200-500KB
 * preserving high visual quality while drastically speeding up uploads.
 */

export async function compressImage(file, { maxWidth = 1920, maxHeight = 1920, quality = 0.85 } = {}) {
  // If not an image or is animated GIF/SVG, return untouched
  if (!file || !file.type || !file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") {
    return file;
  }

  // If already very small (< 200KB), no need to re-encode
  if (file.size < 200 * 1024) {
    return file;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        // If dimensions are within bounds and file isn't huge, return original
        if (width <= maxWidth && height <= maxHeight && file.size < 600 * 1024) {
          resolve(file);
          return;
        }

        // Calculate proportional scale
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
        const finalQuality = file.type === "image/png" ? undefined : quality;

        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              // If compressed blob somehow ended up larger, keep original
              resolve(file);
              return;
            }

            const cleanName = file.name || "photo.jpg";
            const compressedFile = new File([blob], cleanName, {
              type: blob.type || outputType,
              lastModified: Date.now(),
            });

            resolve(compressedFile);
          },
          outputType,
          finalQuality
        );
      };

      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };

    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

/**
 * Compresses an array of files/items before upload
 */
export async function compressMediaItems(items) {
  if (!items || !items.length) return [];
  return Promise.all(
    items.map(async (item) => {
      const originalFile = item.file || item.blob || item;
      const compressed = await compressImage(originalFile);
      if (item.file || item.blob) {
        return {
          ...item,
          file: compressed,
          blob: compressed,
        };
      }
      return compressed;
    })
  );
}
