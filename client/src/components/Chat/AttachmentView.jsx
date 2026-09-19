import { useState } from "react";
import { formatBytes } from "../../utils/time";
import Lightbox from "./Lightbox";
import { DownloadIcon, FileIcon as FileVectorIcon } from "../common/Icons";

function getExtensionBadge(name = "") {
  const ext = name.split(".").pop()?.toUpperCase().slice(0, 4) || "FILE";
  let colorClass = "ext-default";
  if (["PDF"].includes(ext)) colorClass = "ext-pdf";
  else if (["ZIP", "RAR", "7Z", "TAR", "GZ"].includes(ext)) colorClass = "ext-zip";
  else if (["DOC", "DOCX", "TXT", "MD"].includes(ext)) colorClass = "ext-doc";
  else if (["JS", "TS", "JSX", "TSX", "PY", "HTML", "CSS", "JSON"].includes(ext)) colorClass = "ext-code";
  else if (["XLS", "XLSX", "CSV"].includes(ext)) colorClass = "ext-sheet";

  return <div className={`file-icon ${colorClass}`}>{ext}</div>;
}

export default function AttachmentView({ attachments }) {
  const [lightbox, setLightbox] = useState(null);
  const images = attachments.filter((a) => a.kind === "image");
  const others = attachments.filter((a) => a.kind !== "image");

  return (
    <div className="attachments">
      {images.length > 0 && (
        <div className={`image-grid count-${Math.min(images.length, 4)}`}>
          {images.slice(0, 4).map((a, i) => (
            <div
              className="image-grid-item"
              key={a.url || i}
              onClick={() => setLightbox({ list: images, index: i })}
            >
              <img src={a.url} alt={a.name} loading="lazy" />
              {i === 3 && images.length > 4 && (
                <div className="image-grid-more">+{images.length - 4}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {others.map((a, i) =>
        a.kind === "video" ? (
          <div key={a.url || i} className="attachment-video-wrap">
            <video src={a.url} controls className="attachment-video" />
          </div>
        ) : a.kind === "audio" ? (
          <div key={a.url || i} className="attachment-audio-wrap">
            <audio src={a.url} controls className="attachment-audio" />
          </div>
        ) : (
          <a
            key={a.url || i}
            href={a.url}
            download={a.name}
            target="_blank"
            rel="noreferrer"
            className="attachment-file"
          >
            {getExtensionBadge(a.name)}
            <div className="attachment-file-info">
              <div className="attachment-file-name" title={a.name}>
                {a.name}
              </div>
              <div className="attachment-file-size">{formatBytes(a.size)}</div>
            </div>
            <div className="attachment-download" title="Download">
              <DownloadIcon size={16} />
            </div>
          </a>
        )
      )}

      {lightbox && (
        <Lightbox
          images={lightbox.list}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
