import { useEffect, useState } from "react";
import { CloseIcon, DownloadIcon } from "../common/Icons";

export default function Lightbox({ images, startIndex = 0, onClose }) {
  const [index, setIndex] = useState(startIndex);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, images.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  const img = images[index];
  if (!img) return null;

  return (
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <button className="lightbox-close" onClick={onClose} title="Close (Esc)">
        <CloseIcon size={20} />
      </button>
      {index > 0 && (
        <button
          className="lightbox-nav left"
          onClick={() => setIndex((i) => i - 1)}
          title="Previous image"
        >
          ‹
        </button>
      )}
      <img src={img.url} alt={img.name || "Photo"} className="lightbox-img" />
      {index < images.length - 1 && (
        <button
          className="lightbox-nav right"
          onClick={() => setIndex((i) => i + 1)}
          title="Next image"
        >
          ›
        </button>
      )}
      <a className="lightbox-download" href={img.url} download={img.name || "image.png"}>
        <DownloadIcon size={16} /> Download
      </a>
    </div>
  );
}
