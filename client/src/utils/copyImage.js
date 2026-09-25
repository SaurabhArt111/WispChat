function blobToPng(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        canvas.toBlob(
          (pngBlob) => {
            URL.revokeObjectURL(url);
            if (pngBlob) resolve(pngBlob);
            else reject(new Error("Failed to convert image to PNG"));
          },
          "image/png",
          1
        );
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode image"));
    };

    img.src = url;
  });
}

export async function copyImageToClipboard(url, showToast) {
  if (!url) {
    showToast?.("No image to copy.", "danger");
    return false;
  }

  const secureContext = window.isSecureContext || location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!secureContext) {
    showToast?.("Copy image needs a secure browser context. Open this app on HTTPS or localhost.", "danger");
    return false;
  }

  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    showToast?.("This browser does not support direct image copying.", "danger");
    return false;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image (${response.status})`);
    }

    let blob = await response.blob();
    const originalType = blob.type || "image/png";

    if (!originalType.startsWith("image/")) {
      blob = new Blob([blob], { type: "image/png" });
    }

    // Chrome and some Chromium-based browsers reject certain image types on
    // clipboard write, especially JPEG/WebP, while PNG is the safest universal
    // clipboard format.
    const pngBlob = originalType === "image/png" ? blob : await blobToPng(blob);

    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": pngBlob,
      }),
    ]);

    showToast?.("Image copied to clipboard");
    return true;
  } catch (error) {
    console.error("copyImageToClipboard failed:", error);
    showToast?.("Couldn't copy image — your browser may not allow it", "danger");
    return false;
  }
}
