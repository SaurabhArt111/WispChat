import { useState } from "react";
import { formatBytes } from "../../utils/time";
import { useContextMenu } from "../../context/ContextMenuContext";
import { useToast } from "../../context/ToastContext";
import { useDecryptedMediaUrl } from "../../hooks/useDecryptedMessage";
import Lightbox from "./Lightbox";
import {
  DownloadIcon,
  ForwardIcon,
  ReplyIcon,
  CopyIcon,
  TrashIcon,
  LockIcon,
  ExternalLinkIcon,
  InfoIcon,
} from "../common/Icons";
import { SafeImage, SafeVideo } from "../common/SafeMedia";

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

function ProgressRing({ progress = 0, size = 34 }) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <div
      className="progress-ring"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(#5ef2c0 ${pct * 360}deg, rgba(255,255,255,0.18) 0deg)`,
      }}
    >
      <div className="progress-ring-hole" />
    </div>
  );
}

function PendingImage({ a }) {
  return (
    <div className="image-grid-item attachment-pending">
      <img src={a.localUrl} alt={a.name} className="image-grid-img" />
      <div className="attachment-pending-overlay">
        <ProgressRing progress={a.progress} />
        <span>{a.stage === "compressing" ? "Optimizing…" : "Sending…"}</span>
      </div>
    </div>
  );
}

function PendingVideo({ a }) {
  return (
    <div className="attachment-video-wrap attachment-pending">
      <video src={a.localUrl} className="attachment-video" muted />
      <div className="attachment-pending-overlay">
        <ProgressRing progress={a.progress} />
        <span>{a.stage === "compressing" ? "Compressing…" : "Sending…"}</span>
      </div>
    </div>
  );
}

function PendingGeneric({ a }) {
  return (
    <div className="attachment-file attachment-pending-row">
      <ProgressRing progress={a.progress} size={28} />
      <div className="attachment-file-info">
        <div className="attachment-file-name" title={a.name}>
          {a.name}
        </div>
        <div className="attachment-file-size">{a.stage === "compressing" ? "Optimizing…" : "Sending…"}</div>
      </div>
    </div>
  );
}

async function copyImageToClipboard(resolvedUrl, showToast) {
  try {
    const res = await fetch(resolvedUrl);
    const blob = await res.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    showToast?.("Image copied to clipboard");
  } catch {
    showToast?.("Couldn't copy image — your browser may not allow it", "danger");
  }
}

// Encrypted attachments need their bytes decrypted before they can be
// shown at all, so each one is wrapped in a tiny component that resolves
// a usable (blob:) src via useDecryptedMediaUrl before rendering.

function AttachmentImage({ message, a, onClick, onContextMenu }) {
  const { url, loading, error } = useDecryptedMediaUrl(message, a);
  if (loading) return <div className="image-grid-item attachment-decrypting"><LockIcon size={18} /></div>;
  if (error || !url) return <div className="image-grid-item attachment-decrypt-error">Couldn't decrypt</div>;
  return (
    <div className="image-grid-item" onClick={() => onClick(url)} onContextMenu={(e) => onContextMenu(e, url)}>
      <SafeImage src={url} alt={a.name} loading="lazy" className="image-grid-img" />
    </div>
  );
}

function AttachmentVideo({ message, a, onContextMenu }) {
  const { url, loading, error } = useDecryptedMediaUrl(message, a);
  return (
    <div className="attachment-video-wrap" onContextMenu={(e) => onContextMenu(e, url)}>
      {loading ? (
        <div className="attachment-decrypting"><LockIcon size={18} /> Decrypting…</div>
      ) : error || !url ? (
        <div className="attachment-decrypt-error">Couldn't decrypt video</div>
      ) : (
        <SafeVideo src={url} controls className="attachment-video" />
      )}
    </div>
  );
}

function AttachmentAudio({ message, a }) {
  const { url, loading, error } = useDecryptedMediaUrl(message, a);
  return (
    <div className="attachment-audio-wrap">
      {loading ? (
        <div className="attachment-decrypting"><LockIcon size={14} /> Decrypting…</div>
      ) : error || !url ? (
        <div className="attachment-decrypt-error">Couldn't decrypt audio</div>
      ) : (
        <audio src={url} controls className="attachment-audio" />
      )}
    </div>
  );
}

function AttachmentFile({ message, a, onContextMenu }) {
  const { url, loading, error } = useDecryptedMediaUrl(message, a);
  return (
    <a
      href={url || undefined}
      download={a.name}
      target="_blank"
      rel="noreferrer"
      className={`attachment-file ${!url ? "attachment-file-disabled" : ""}`}
      onClick={(e) => {
        if (!url) e.preventDefault();
      }}
      onContextMenu={(e) => onContextMenu(e, url)}
    >
      {getExtensionBadge(a.name)}
      <div className="attachment-file-info">
        <div className="attachment-file-name" title={a.name}>
          {a.name}
        </div>
        <div className="attachment-file-size">
          {loading ? "Decrypting…" : error ? "Couldn't decrypt" : formatBytes(a.size)}
        </div>
      </div>
      <div className="attachment-download" title="Download">
        <DownloadIcon size={16} />
      </div>
    </a>
  );
}

export default function AttachmentView({ message, attachments, onForward, onReply, onDeleteRequest }) {
  const [lightbox, setLightbox] = useState(null);
  const { openMenu } = useContextMenu();
  const { showToast } = useToast();
  const images = attachments.filter((a) => a.kind === "image");
  const others = attachments.filter((a) => a.kind !== "image");

  function imageContextMenu(e, a, resolvedUrl) {
    openMenu(e, [
      onReply && { label: "Reply", icon: <ReplyIcon size={15} />, onClick: onReply },
      onForward && { label: "Forward", icon: <ForwardIcon size={15} />, onClick: onForward },
      resolvedUrl && {
        label: "Open in new tab",
        icon: <ExternalLinkIcon size={15} />,
        onClick: () => window.open(resolvedUrl, "_blank", "noopener,noreferrer"),
      },
      resolvedUrl && a.kind === "image" && {
        label: "Copy image",
        icon: <CopyIcon size={15} />,
        onClick: () => copyImageToClipboard(resolvedUrl, showToast),
      },
      resolvedUrl && {
        label: "Save as…",
        icon: <DownloadIcon size={15} />,
        onClick: () => {
          const link = document.createElement("a");
          link.href = resolvedUrl;
          link.download = a.name || "file";
          link.click();
        },
      },
      { label: "File info", icon: <InfoIcon size={15} />, onClick: () => showToast(`${a.name} · ${formatBytes(a.size)}`) },
      onDeleteRequest && { divider: true },
      onDeleteRequest && { label: "Delete", danger: true, icon: <TrashIcon size={15} />, onClick: onDeleteRequest },
    ].filter(Boolean));
  }

  return (
    <div className="attachments">
      {images.length > 0 && (
        <div className={`image-grid count-${Math.min(images.length, 4)}`}>
          {images.slice(0, 4).map((a, i) =>
            a._local ? (
              <PendingImage key={a.localId || i} a={a} />
            ) : (
              <AttachmentImage
                key={a.url || i}
                message={message}
                a={a}
                onClick={(resolvedUrl) => setLightbox({ list: images, index: i, url: resolvedUrl })}
                onContextMenu={(e, resolvedUrl) => imageContextMenu(e, a, resolvedUrl)}
              />
            )
          )}
          {images.length > 4 && <div className="image-grid-more">+{images.length - 4}</div>}
        </div>
      )}

      {others.map((a, i) =>
        a._local ? (
          a.kind === "video" ? (
            <PendingVideo key={a.localId || i} a={a} />
          ) : (
            <PendingGeneric key={a.localId || i} a={a} />
          )
        ) : a.kind === "video" ? (
          <AttachmentVideo key={a.url || i} message={message} a={a} onContextMenu={(e) => imageContextMenu(e, a)} />
        ) : a.kind === "audio" ? (
          <AttachmentAudio key={a.url || i} message={message} a={a} />
        ) : (
          <AttachmentFile key={a.url || i} message={message} a={a} onContextMenu={(e) => imageContextMenu(e, a)} />
        )
      )}

      {lightbox && (
        <Lightbox
          message={message}
          images={lightbox.list}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          onForward={onForward ? () => { onForward(); setLightbox(null); } : undefined}
        />
      )}
    </div>
  );
}
