import { useEffect, useState } from "react";
import client from "../../api/client";
import { useChat } from "../../context/ChatContext";
import { useDecryptedMediaUrl } from "../../hooks/useDecryptedMessage";
import Lightbox from "../Chat/Lightbox";
import { SafeImage, SafeVideo } from "../common/SafeMedia";
import { LockIcon } from "../common/Icons";
import MediaStatsChart from "./MediaStatsChart";
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

export default function MediaStoragePanel() {
  const { openConversation } = useChat();
  const [stats, setStats] = useState(null);
  const [kind, setKind] = useState("image");
  const [items, setItems] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  useEffect(() => {
    client.get("/messages/media/stats").then((res) => setStats(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setItems(null);
    client
      .get(`/messages/media/list?kind=${kind}&limit=60`)
      .then((res) => setItems(res.data.items))
      .catch(() => setItems([]));
  }, [kind]);

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
      </div>
      <div className="rail-panel-scroll">
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

        {items === null ? (
          <div className="rail-panel-empty">
            <p>Loading…</p>
          </div>
        ) : items.length === 0 ? (
          <div className="rail-panel-empty">
            <LayersIcon size={26} />
            <p>Nothing here yet — {KIND_TABS.find((t) => t.id === kind)?.label.toLowerCase()} you send or receive across every chat will show up here.</p>
          </div>
        ) : kind === "image" || kind === "video" ? (
          <div className="media-storage-grid">
            {items.map((item, i) => (
              <GridThumb
                key={item.url + i}
                item={item}
                onClick={() =>
                  item.kind === "video" ? openInChat(item) : setLightboxIndex(imageItems.findIndex((m) => m.url === item.url))
                }
              />
            ))}
          </div>
        ) : (
          <div className="media-storage-list">
            {items.map((item, i) => (
              <button key={item.url + i} className="media-storage-row" onClick={() => openInChat(item)}>
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
            ))}
          </div>
        )}
      </div>

      {lightboxIndex !== null && (
        <Lightbox images={imageItems} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
    </aside>
  );
}
