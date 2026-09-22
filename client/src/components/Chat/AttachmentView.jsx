import { useState } from "react";
import { formatBytes } from "../../utils/time";
import { useContextMenu } from "../../context/ContextMenuContext";
import { useToast } from "../../context/ToastContext";
import Lightbox from "./Lightbox";
import {
  DownloadIcon,
  FileIcon as FileVectorIcon,
  ForwardIcon,
  ReplyIcon,
  CopyIcon,
  TrashIcon,
} from "../common/Icons";
import { SafeImage, SafeVideo } from "../common/SafeMedia";
import { mediaUrl } from "../../api/config";

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

async function copyImageToClipboard(url, showToast) {
  try {
    const res = await fetch(mediaUrl(url));
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    showToast?.("Image copied to clipboard");
  } catch {
    showToast?.("Couldn't copy image — your browser may not allow it", "danger");
  }
}

export default function AttachmentView({ attachments, onForward, onReply, onDeleteRequest }) {
  const [lightbox, setLightbox] = useState(null);
  const { openMenu } = useContextMenu();
  const { showToast } = useToast();
  const images = attachments.filter((a) => a.kind === "image");
  const others = attachments.filter((a) => a.kind !== "image");

  function imageContextMenu(e, a) {
    openMenu(e, [
      onReply && { label: "Reply", icon: <ReplyIcon size={15} />, onClick: onReply },
      onForward && { label: "Forward", icon: <ForwardIcon size={15} />, onClick: onForward },
      { label: "Copy image", icon: <CopyIcon size={15} />, onClick: () => copyImageToClipboard(a.url, showToast) },
      {
        label: "Save as…",
        icon: <DownloadIcon size={15} />,
        onClick: () => {
          const link = document.createElement("a");
          link.href = mediaUrl(a.url);
          link.download = a.name || "image.png";
          link.click();
        },
      },
      onDeleteRequest && { divider: true },
      onDeleteRequest && { label: "Delete", danger: true, icon: <TrashIcon size={15} />, onClick: onDeleteRequest },
    ].filter(Boolean));
  }

  return (
    <div className="attachments">
      {images.length > 0 && (
        <div className={`image-grid count-${Math.min(images.length, 4)}`}>
          {images.slice(0, 4).map((a, i) => (
            <div
              className="image-grid-item"
              key={a.url || i}
              onClick={() => setLightbox({ list: images, index: i })}
              onContextMenu={(e) => imageContextMenu(e, a)}
            >
              <SafeImage src={mediaUrl(a.url)} alt={a.name} loading="lazy" className="image-grid-img" />
              {i === 3 && images.length > 4 && (
                <div className="image-grid-more">+{images.length - 4}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {others.map((a, i) =>
        a.kind === "video" ? (
          <div key={a.url || i} className="attachment-video-wrap" onContextMenu={(e) => imageContextMenu(e, a)}>
            <SafeVideo src={mediaUrl(a.url)} controls className="attachment-video" />
          </div>
        ) : a.kind === "audio" ? (
          <div key={a.url || i} className="attachment-audio-wrap">
            <audio src={mediaUrl(a.url)} controls className="attachment-audio" />
          </div>
        ) : (
          <a
            key={a.url || i}
            href={mediaUrl(a.url)}
            download={a.name}
            target="_blank"
            rel="noreferrer"
            className="attachment-file"
            onContextMenu={(e) => imageContextMenu(e, a)}
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
          onForward={onForward ? () => { onForward(); setLightbox(null); } : undefined}
        />
      )}
    </div>
  );
}
