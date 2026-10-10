import { useEffect, useState } from "react";
import client from "../../api/client";
import { mediaUrl } from "../../api/config";
import { hostOf } from "../../utils/linkify";
import { ExternalLinkIcon } from "../common/Icons";

// Session cache so scrolling a long chat (virtualised rows remount) never
// refetches the same page, and one URL shared in many messages = one request.
const cache = new Map(); // href -> preview | null (null = "no preview available")
const inflight = new Map();

function loadPreview(href) {
  if (cache.has(href)) return Promise.resolve(cache.get(href));
  if (inflight.has(href)) return inflight.get(href);
  const p = client
    .get("/link-preview", { params: { url: href } })
    .then((res) => res.data.preview || null)
    .catch(() => null)
    .then((preview) => {
      cache.set(href, preview);
      inflight.delete(href);
      return preview;
    });
  inflight.set(href, p);
  return p;
}

export function linkPreviewsEnabled() {
  try {
    return localStorage.getItem("wisp_link_previews") !== "false";
  } catch {
    return true;
  }
}

// WhatsApp-style "rich link" card: picture, title, short description and the
// site name. The whole card opens the page in a NEW tab/window. If the page
// can't be previewed (blocked, not HTML, timeout…) nothing is rendered — the
// plain link inside the message text is still tappable.
export default function LinkPreviewCard({ href }) {
  const [preview, setPreview] = useState(() => (cache.has(href) ? cache.get(href) : undefined));
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (cache.has(href)) {
      setPreview(cache.get(href));
      return;
    }
    setPreview(undefined);
    loadPreview(href).then((p) => !cancelled && setPreview(p));
    return () => {
      cancelled = true;
    };
  }, [href]);

  if (preview === null) return null;

  if (preview === undefined) {
    return (
      <div className="link-card link-card-loading" aria-busy="true">
        <div className="skeleton link-card-skel-img" />
        <div className="link-card-body">
          <div className="skeleton skeleton-text w-80" />
          <div className="skeleton skeleton-text w-60" />
        </div>
      </div>
    );
  }

  const showImage = preview.image && !imgFailed;
  return (
    <a
      className={`link-card ${showImage ? "has-image" : "no-image"}`}
      href={preview.url || href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={preview.url || href}
    >
      {showImage && (
        <div className="link-card-image">
          <img
            src={mediaUrl(preview.image)}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
          />
        </div>
      )}
      <div className="link-card-body">
        <div className="link-card-title">{preview.title}</div>
        {preview.description && <div className="link-card-desc">{preview.description}</div>}
        <div className="link-card-host">
          {preview.favicon && !showImage && (
            <img className="link-card-favicon" src={preview.favicon} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} />
          )}
          <span>{preview.siteName || preview.host || hostOf(href)}</span>
          <ExternalLinkIcon size={11} />
        </div>
      </div>
    </a>
  );
}
