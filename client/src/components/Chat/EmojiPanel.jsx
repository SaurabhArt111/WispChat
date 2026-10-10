import { useEffect, useRef, useState } from "react";
import EmojiPicker, { EmojiStyle, SuggestionMode } from "emoji-picker-react";
import { GifIcon, SearchIcon, SmileIcon, StickerIcon, CloseIcon } from "../common/Icons";

// WhatsApp-style panel with three tabs — Emoji, GIF and Stickers — plus a
// "Recent" strip that remembers what you used last.
//  • Emoji    – full picker (categories, search, recents, native glyphs).
//  • GIF      – search/trending via GIPHY when VITE_GIPHY_API_KEY is set.
//  • Stickers – tap a big emoji to send it on its own, enlarged.

const GIPHY_KEY = import.meta.env.VITE_GIPHY_API_KEY || "";
const RECENT_KEY = "wisp_recent_emoji";

const STICKERS = [
  "😍", "😂", "🥹", "😭", "🤣", "😎", "🥳", "🔥",
  "❤️", "💯", "🙏", "👍", "👏", "🎉", "😮", "😢",
  "🤔", "😴", "🤝", "💪", "✨", "🙌", "😡", "🤗",
  "😘", "🥰", "😅", "😇", "🤩", "😬", "🫶", "💀",
];

export function readRecentEmoji() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 16);
  } catch {
    return [];
  }
}
export function pushRecentEmoji(emoji) {
  try {
    const next = [emoji, ...readRecentEmoji().filter((e) => e !== emoji)].slice(0, 16);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function GifTab({ onPickGif }) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    if (!GIPHY_KEY) return undefined;
    const my = ++seq.current;
    setLoading(true);
    setError("");
    const t = setTimeout(async () => {
      try {
        const q = query.trim();
        const url = q
          ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=30&rating=pg-13`
          : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=30&rating=pg-13`;
        const res = await fetch(url);
        const json = await res.json();
        if (my === seq.current) setGifs(json.data || []);
      } catch {
        if (my === seq.current) setError("Couldn't load GIFs. Check your connection.");
      } finally {
        if (my === seq.current) setLoading(false);
      }
    }, query ? 350 : 0);
    return () => clearTimeout(t);
  }, [query]);

  if (!GIPHY_KEY) {
    return (
      <div className="emoji-panel-empty">
        <GifIcon size={34} />
        <p>
          GIF search needs a free GIPHY API key. Add <code>VITE_GIPHY_API_KEY</code> to <code>client/.env</code> and
          rebuild to turn it on.
        </p>
      </div>
    );
  }

  return (
    <div className="gif-tab">
      <div className="gif-search">
        <SearchIcon size={15} />
        <input placeholder="Search GIFs" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <button type="button" className="icon-btn btn-sm" onClick={() => setQuery("")}>
            <CloseIcon size={13} />
          </button>
        )}
      </div>
      {error && <div className="emoji-panel-empty"><p>{error}</p></div>}
      <div className="gif-grid">
        {loading && !gifs.length && Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton gif-skel" />)}
        {gifs.map((g) => {
          const small = g.images?.fixed_width_small || g.images?.fixed_width;
          const full = g.images?.original?.url || g.images?.downsized?.url;
          return (
            <button key={g.id} type="button" className="gif-item" onClick={() => onPickGif(full, g.title)}>
              <img src={small?.url} alt={g.title} loading="lazy" />
            </button>
          );
        })}
        {!loading && !gifs.length && !error && <p className="emoji-panel-hint">No GIFs found.</p>}
      </div>
      <div className="gif-attrib">Powered by GIPHY</div>
    </div>
  );
}

export default function EmojiPanel({ onEmoji, onSticker, onGif, docked }) {
  const [tab, setTab] = useState("emoji");
  const [recent, setRecent] = useState(readRecentEmoji);

  function pick(emoji) {
    pushRecentEmoji(emoji);
    setRecent(readRecentEmoji());
    onEmoji(emoji);
  }

  return (
    <div className={`emoji-panel ${docked ? "docked" : ""}`}>
      <div className="emoji-panel-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "emoji"} className={tab === "emoji" ? "active" : ""} onClick={() => setTab("emoji")}>
          <SmileIcon size={18} /> <span>Emoji</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "gif"} className={tab === "gif" ? "active" : ""} onClick={() => setTab("gif")}>
          <GifIcon size={20} /> <span>GIF</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "sticker"} className={tab === "sticker" ? "active" : ""} onClick={() => setTab("sticker")}>
          <StickerIcon size={18} /> <span>Stickers</span>
        </button>
      </div>

      {tab === "emoji" && (
        <div className="emoji-panel-body">
          {recent.length > 0 && (
            <div className="emoji-recent">
              <div className="emoji-recent-label">Recent</div>
              <div className="emoji-recent-row">
                {recent.map((e) => (
                  <button key={e} type="button" onClick={() => pick(e)}>{e}</button>
                ))}
              </div>
            </div>
          )}
          <EmojiPicker
            theme="dark"
            // Native glyphs: no CDN fetch, so it works offline and isn't
            // blocked by tracking-prevention (see previous implementation).
            emojiStyle={EmojiStyle.NATIVE}
            suggestedEmojisMode={SuggestionMode.RECENT}
            onEmojiClick={(e) => pick(e.emoji)}
            width="100%"
            height={docked ? 270 : 320}
            lazyLoadEmojis
            skinTonesDisabled
            previewConfig={{ showPreview: false }}
          />
        </div>
      )}

      {tab === "gif" && <GifTab onPickGif={onGif} />}

      {tab === "sticker" && (
        <div className="sticker-grid">
          {STICKERS.map((s) => (
            <button key={s} type="button" className="sticker-item" onClick={() => onSticker(s)} title="Send">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
