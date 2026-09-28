import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso, VirtuosoGrid } from "react-virtuoso";
import client from "../../api/client";
import { useChat } from "../../context/ChatContext";
import { useDecryptedMediaUrl } from "../../hooks/useDecryptedMessage";
import Lightbox from "../Chat/Lightbox";
import { SafeImage, SafeVideo } from "../common/SafeMedia";
import { LockIcon } from "../common/Icons";
import MediaStatsChart from "./MediaStatsChart";
import MobileMoreButton from "./MobileMoreButton";
import { LayersIcon, ImageIcon, VideoIcon, AudioIcon, FileIcon as DocIcon } from "../common/Icons";
import { formatBytes, formatListTime } from "../../utils/time";
import "../../styles/railPanels.css";
import "../../styles/mediastats.css";
import "../../styles/e2ee.css";

const KIND_TABS = [
  { id: "image", label: "Photos", icon: ImageIcon },
  { id: "video", label: "Videos", icon: VideoIcon },
  { id: "audio", label: "Audio", icon: AudioIcon },
  { id: "file", label: "Files", icon: DocIcon },
];

// The gallery is just another view over the same messages shown in a
// chat, not a separate unencrypted copy of anything — so an encrypted
// item here still needs decrypting exactly the same way. Each list item
// carries its owning message's encrypted/iv/keys/sender fields (see
// getMediaList) specifically so this reconstruction is possible without
// a second round trip.
function itemAsMessage(item) {
  return {
    _id: item.messageId,
    sender: item.sender,
    encrypted: item.messageEncrypted,
    text: item.messageText,
    iv: item.messageIv,
    keys: item.messageKeys,
  };
}

function GridThumb({ item, onClick }) {
  const { url, loading, error } = useDecryptedMediaUrl(itemAsMessage(item), item);
  if (loading) {
    return (
      <div className="media-storage-thumb attachment-decrypting">
        <LockIcon size={16} />
      </div>
    );
  }
  if (error || !url) {
    return <div className="media-storage-thumb attachment-decrypt-error">Unavailable</div>;
  }
  return item.kind === "video" ? (
    <SafeVideo src={url} className="media-storage-thumb" muted onClick={onClick} />
  ) : (
    <SafeImage src={url} className="media-storage-thumb" onClick={onClick} />
  );
}

// Defined at module level (and fed via Virtuoso's `context`) so its identity
// is stable — an inline component would be re-created every render and
// remount the stats chart and tabs each time the list scrolls or updates.
function PanelHeader({ context }) {
  const { stats, kind, setKind } = context;
  return (
    <>
      <div className="rail-panel-section">
        <div className="rail-panel-section-title">
          <LayersIcon size={15} /> Everything shared & received
        </div>
        <MediaStatsChart stats={stats} />
      </div>
      <div className="media-kind-tabs">
        {KIND_TABS.map((t) => (
          <button
            key={t.id}
            className={`media-kind-tab ${kind === t.id ? "active" : ""}`}
            onClick={() => setKind(t.id)}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
    </>
  );
}

function PanelFooter({ context }) {
  const { items, kind, loadingMore } = context;
  if (items === null) return <div className="rail-panel-empty"><p>Loading…</p></div>;
  if (items.length === 0) {
    return (
      <div className="rail-panel-empty">
        <LayersIcon size={26} />
        <p>Nothing here yet — {KIND_TABS.find((t) => t.id === kind)?.label.toLowerCase()} you send or receive across every chat will show up here.</p>
      </div>
    );
  }
  return loadingMore ? <div className="rail-panel-empty"><p>Loading more…</p></div> : <div style={{ height: 24 }} />;
}

const PAGE = 60;

export default function MediaStoragePanel({ onOpenMore }) {
  const { openConversation } = useChat();
  const [stats, setStats] = useState(null);
  const [kind, setKind] = useState("image");
  const [items, setItems] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  useEffect(() => {
    client.get("/messages/media/stats").then((res) => setStats(res.data)).catch(() => {});
  }, []);

  const [loadingMore, setLoadingMore] = useState(false);
  const doneRef = useRef(false);
  const busyRef = useRef(false);

  useEffect(() => {
    let active = true;
    setItems(null);
    doneRef.current = false;
    busyRef.current = false;
    client
      .get(`/messages/media/list?kind=${kind}&limit=${PAGE}`)
      .then((res) => {
        if (!active) return;
        setItems(res.data.items);
        if (res.data.items.length < PAGE) doneRef.current = true;
      })
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, [kind]);

  // Next page as the virtualized list nears its end.
  const loadMore = useCallback(async () => {
    if (busyRef.current || doneRef.current || !items?.length) return;
    busyRef.current = true;
    setLoadingMore(true);
    try {
      const before = items[items.length - 1].createdAt;
      const res = await client.get(
        `/messages/media/list?kind=${kind}&limit=${PAGE}&before=${encodeURIComponent(before)}`
      );
      const next = res.data.items || [];
      if (next.length < PAGE) doneRef.current = true;
      setItems((prev) => [...prev, ...next]);
    } catch {
      doneRef.current = true;
    } finally {
      busyRef.current = false;
      setLoadingMore(false);
    }
  }, [items, kind]);

  function openInChat(item) {
    openConversation(item.conversationId);
    setTimeout(() => {
      const el = document.getElementById(`msg-${item.messageId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("highlighted-bubble");
        setTimeout(() => el.classList.remove("highlighted-bubble"), 2000);
      }
    }, 250);
  }

  const imageItems = kind === "image" && items ? items.map((it) => ({ ...it, _message: itemAsMessage(it) })) : [];

  return (
    <aside className="rail-panel">
      <div className="rail-panel-header">
        <h2>Media & Storage</h2>
        {onOpenMore && <MobileMoreButton onClick={onOpenMore} />}
      </div>
      {kind === "image" || kind === "video" ? (
        <VirtuosoGrid
          key={kind}
          style={{ flex: 1, minHeight: 0 }}
          data={items || []}
          context={{ stats, kind, setKind, items, loadingMore }}
          computeItemKey={(index, item) => `${item.messageId}-${item.url}`}
          listClassName="media-virtual-grid"
          itemClassName="media-virtual-grid-item"
          overscan={400}
          endReached={loadMore}
          components={{ Header: PanelHeader, Footer: PanelFooter }}
          itemContent={(index, item) => (
            <GridThumb
              item={item}
              onClick={() =>
                item.kind === "video" ? openInChat(item) : setLightboxIndex(imageItems.findIndex((m) => m.url === item.url))
              }
            />
          )}
        />
      ) : (
        <Virtuoso
          key={kind}
          style={{ flex: 1, minHeight: 0 }}
          data={items || []}
          context={{ stats, kind, setKind, items, loadingMore }}
          computeItemKey={(index, item) => `${item.messageId}-${item.url}`}
          overscan={300}
          endReached={loadMore}
          components={{ Header: PanelHeader, Footer: PanelFooter }}
          itemContent={(index, item) => (
            <button className="media-storage-row" onClick={() => openInChat(item)}>
              <div className="media-storage-row-icon">
                {kind === "audio" ? <AudioIcon size={16} /> : <DocIcon size={16} />}
              </div>
              <div className="media-storage-row-meta">
                <div className="media-storage-row-name">{item.name}</div>
                <div className="media-storage-row-sub">
                  {item.sender?.displayName} · {formatBytes(item.size)} · {formatListTime(item.createdAt)}
                </div>
              </div>
            </button>
          )}
        />
      )}

      {lightboxIndex !== null && (
        <Lightbox images={imageItems} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
    </aside>
  );
}
