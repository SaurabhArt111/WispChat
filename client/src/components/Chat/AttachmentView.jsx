import { useState } from "react";
import { formatBytes } from "../../utils/time";
import { copyImageToClipboard } from "../../utils/copyImage";
import { useContextMenu } from "../../context/ContextMenuContext";
import { useToast } from "../../context/ToastContext";
import { useDecryptedMediaUrl } from "../../hooks/useDecryptedMessage";
import Lightbox from "./Lightbox";
import ForwardModal from "./ForwardModal";
import { useGallery } from "../../context/GalleryContext";
import {
  DownloadIcon,
  ForwardIcon,
  ReplyIcon,
  CopyIcon,
  TrashIcon,
  LockIcon,
  ExternalLinkIcon,
  InfoIcon,
  AlertIcon,
} from "../common/Icons";
import { SafeAudio, SafeImage, SafeVideo } from "../common/SafeMedia";

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

function PendingImage({ a, overlay }) {
  return (
    <div className="image-grid-item attachment-pending">
      <img src={a.localUrl} alt={a.name} className="image-grid-img" />
      <div className="attachment-pending-overlay">
        <ProgressRing progress={a.progress} />
        <span>{a.stage === "compressing" ? "Optimizing…" : "Sending…"}</span>
      </div>
      {overlay}
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

// Encrypted attachments need their bytes decrypted before they can be
// shown at all, so each one is wrapped in a tiny component that resolves
// a usable (blob:) src via useDecryptedMediaUrl before rendering.


// One shared, friendly error state for encrypted attachments. It says WHY it
// failed (file gone from server vs. network blip vs. locked vs. bad key) and
// offers Retry where retrying can actually help.
const PROBLEM_TEXT = {
  missing: { title: "File unavailable", hint: "It was removed from the server", retry: false },
  network: { title: "Couldn't load", hint: "Connection problem", retry: true },
  locked: { title: "Locked", hint: "Unlock encryption to view", retry: true },
  decrypt: { title: "Couldn't decrypt", hint: "Wrong key for this file", retry: false },
};

function AttachmentProblem({ code = "decrypt", onRetry, compact = false, label = "" }) {
  const info = PROBLEM_TEXT[code] || PROBLEM_TEXT.decrypt;
  return (
    <div className={`attachment-problem ${compact ? "compact" : ""} code-${code}`} role="status">
      <AlertIcon size={compact ? 15 : 20} />
      <div className="attachment-problem-text">
        <strong>{label ? `${info.title} · ${label}` : info.title}</strong>
        {!compact && <span>{info.hint}</span>}
      </div>
      {info.retry && onRetry && (
        <button
          type="button"
          className="attachment-problem-retry"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function AttachmentImage({ message, a, onClick, onContextMenu, overlay }) {
  const { url, loading, error, errorCode, retry } = useDecryptedMediaUrl(message, a);
  if (loading) return <div className="image-grid-item attachment-decrypting"><LockIcon size={18} /></div>;
  if (error || !url)
    return (
      <div
        className="image-grid-item attachment-decrypt-error"
        onContextMenu={(e) => onContextMenu(e, null)}
        // A file that's gone for good: tapping it explains why (the viewer shows the dialog).
        onClick={errorCode === "missing" ? () => onClick(null) : undefined}
        style={errorCode === "missing" ? { cursor: "pointer" } : undefined}
      >
        <AttachmentProblem code={errorCode} onRetry={retry} compact />
      </div>
    );
  return (
    <div className="image-grid-item" onClick={() => onClick(url)} onContextMenu={(e) => onContextMenu(e, url)}>
      <SafeImage src={url} alt={a.name} loading="lazy" className="image-grid-img" />
      {overlay}
    </div>
  );
}

function AttachmentVideo({ message, a, onContextMenu }) {
  const { url, loading, error, errorCode, retry } = useDecryptedMediaUrl(message, a);
  return (
    <div className="attachment-video-wrap" onContextMenu={(e) => onContextMenu(e, url)}>
      {loading ? (
        <div className="attachment-decrypting"><LockIcon size={18} /> Decrypting…</div>
      ) : error || !url ? (
        <div className="attachment-decrypt-error"><AttachmentProblem code={errorCode} onRetry={retry} label="video" /></div>
      ) : (
        <SafeVideo src={url} controls className="attachment-video" />
      )}
    </div>
  );
}

function AttachmentAudio({ message, a }) {
  const { url, loading, error, errorCode, retry } = useDecryptedMediaUrl(message, a);
  return (
    <div className="attachment-audio-wrap">
      {loading ? (
        <div className="attachment-decrypting"><LockIcon size={14} /> Decrypting…</div>
      ) : error || !url ? (
        <div className="attachment-decrypt-error"><AttachmentProblem code={errorCode} onRetry={retry} label="audio" compact /></div>
      ) : (
        <SafeAudio src={url} controls className="attachment-audio" />
      )}
    </div>
  );
}

function AttachmentFile({ message, a, onContextMenu }) {
  const { url, loading, error, errorCode, retry } = useDecryptedMediaUrl(message, a);
  const canOpen = !!url && !loading && !error;

  function save() {
    if (!canOpen) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = a.name || "file";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <div className={`attachment-file attachment-file-card ${!canOpen ? "attachment-file-disabled" : ""}`} onContextMenu={(e) => onContextMenu(e, url)}>
      <div className="attachment-file-top">
        {getExtensionBadge(a.name)}
        <div className="attachment-file-info">
          <div className="attachment-file-name" title={a.name}>
            {a.name}
          </div>
          <div className="attachment-file-size">
            {loading ? "Decrypting…" : error ? PROBLEM_TEXT[errorCode]?.title || "Couldn't decrypt" : `${(a.name.split(".").pop() || "FILE").toUpperCase()} · ${formatBytes(a.size)}`}
          </div>
        </div>
      </div>
      {/* WhatsApp-style action row */}
      <div className="attachment-file-actions">
        {error && PROBLEM_TEXT[errorCode]?.retry ? (
          <button type="button" onClick={retry}>Retry</button>
        ) : (
          <>
            <button type="button" disabled={!canOpen} onClick={() => canOpen && window.open(url, "_blank", "noopener,noreferrer")}>
              Open
            </button>
            <button type="button" disabled={!canOpen} onClick={save}>
              Save as…
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function AttachmentView({
  message,
  attachments,
  userId,
  reactToMessage,
  onForward,
  onReply,
  onDeleteRequest,
}) {
  const [lightbox, setLightbox] = useState(null);
  const [forwardOther, setForwardOther] = useState(null); // forwarding a photo that belongs to a different message
  const gallery = useGallery();
  const { openMenu } = useContextMenu();
  const { showToast } = useToast();
  const images = attachments.filter((a) => a.kind === "image");
  const others = attachments.filter((a) => a.kind !== "image");

  // Open on this photo, but let the viewer swipe through the whole chat's media.
  function openViewer(a, i, resolvedUrl) {
    const all = gallery?.getGallery?.() || [];
    const at = all.findIndex((g) => g.url === a.url && g._message?._id === message._id);
    if (at >= 0) setLightbox({ list: all, index: at, url: resolvedUrl });
    else setLightbox({ list: images, index: i, url: resolvedUrl });
  }

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
          {images.slice(0, 4).map((a, i) => {
            const isLastVisible = i === 3 && images.length > 4;
            const moreOverlay = isLastVisible ? (
              <div className="image-grid-more">+{images.length - 4}</div>
            ) : null;
            return a._local ? (
              <PendingImage key={a.localId || i} a={a} overlay={moreOverlay} />
            ) : (
              <AttachmentImage
                key={a.url || i}
                message={message}
                a={a}
                overlay={moreOverlay}
                onClick={(resolvedUrl) => openViewer(a, i, resolvedUrl)}
                onContextMenu={(e, resolvedUrl) => imageContextMenu(e, a, resolvedUrl)}
              />
            );
          })}
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
          userId={userId}
          reactToMessage={reactToMessage}
          onClose={() => setLightbox(null)}
          onForward={
            onForward
              ? (cur) => {
                  const owner = cur?._message;
                  if (owner && owner._id !== message._id) setForwardOther(owner);
                  else onForward();
                  setLightbox(null);
                }
              : undefined
          }
        />
      )}
      {forwardOther && <ForwardModal message={forwardOther} onClose={() => setForwardOther(null)} />}
    </div>
  );
}
