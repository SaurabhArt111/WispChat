import { useEffect, useRef, useState } from "react";
import EmojiPicker, { Categories, EmojiStyle, SuggestionMode } from "emoji-picker-react";
import { SearchIcon, SmileIcon, StickerIcon, CloseIcon } from "../common/Icons";
import client from "../../api/client";

// WhatsApp-style panel with three tabs — Emoji, GIF and Stickers — plus a
// "Recent" strip that remembers what you used last.
//  • Emoji    – full picker (categories, search, recents, native glyphs).
//  • GIF      – trending + search (GIPHY, through the WispChat server).
//  • Stickers – trending + search GIPHY stickers (transparent, sent bubble-less).

const GIPHY_KEY = import.meta.env.VITE_GIPHY_API_KEY || "";
const RECENT_KEY = "wisp_recent_emoji";


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

// ---- GIFs & stickers -------------------------------------------------------------------
// Fetched through the WispChat server (/api/gifs → GIPHY, key stays on the server and results
// are cached there). If the server has no key but VITE_GIPHY_API_KEY is set, GIPHY is called directly.
const gifCache = new Map(); // "gifs|cats|0" → { items, hasMore } — instant when you come back to a tab / query

function shapeGiphy(g) {
  const img = g.images || {};
  const small = img.fixed_width_small || img.fixed_width || {};
  const send = img.downsized || img.fixed_width || img.original || {};
  return {
    id: g.id,
    title: g.title || "",
    preview: small.webp || small.url || "",
    still: img.fixed_width_small_still?.url || "",
    url: send.url || small.url || "",
    width: Number(small.width) || 100,
    height: Number(small.height) || 100,
  };
}

async function loadGifs(type, q, offset) {
  const key = `${type}|${q}|${offset}`;
  if (gifCache.has(key)) return gifCache.get(key);
  let body;
  try {
    const { data } = await client.get("/gifs", { params: { type, q, offset } });
    body = data;
  } catch (err) {
    if (err?.response?.status !== 503 || !GIPHY_KEY) throw err;
    const path = q ? `search?q=${encodeURIComponent(q)}&` : "trending?";
    const res = await fetch(`https://api.giphy.com/v1/${type}/${path}api_key=${GIPHY_KEY}&limit=30&offset=${offset}&rating=pg-13`);
    const json = await res.json();
    body = { items: (json.data || []).map(shapeGiphy), hasMore: (json.pagination?.total_count || 0) > offset + 30 };
  }
  gifCache.set(key, body);
  if (gifCache.size > 80) gifCache.delete(gifCache.keys().next().value);
  return body;
}

// warm the trending lists when the panel first mounts, so the tabs open instantly
let prefetched = false;
function prefetchTrending() {
  if (prefetched) return;
  prefetched = true;
  loadGifs("gifs", "", 0).catch(() => { prefetched = false; });
  loadGifs("stickers", "", 0).catch(() => {});
}

function GifTab({ type = "gifs", onPick }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);
  const scroller = useRef(null);
  const sticker = type === "stickers";

  useEffect(() => {
    const my = ++seq.current;
    const q = query.trim();
    const cached = gifCache.get(`${type}|${q}|0`);
    if (cached) { setItems(cached.items); setHasMore(cached.hasMore); setError(""); }
    else setLoading(true);
    const t = setTimeout(async () => {
      try {
        const body = await loadGifs(type, q, 0);
        if (my !== seq.current) return;
        setItems(body.items || []); setHasMore(!!body.hasMore); setError("");
        scroller.current?.scrollTo?.({ top: 0 });
      } catch (err) {
        if (my !== seq.current) return;
        setError(err?.response?.status === 503
          ? "GIFs and stickers aren't set up yet: add GIPHY_API_KEY to server/.env (free key at developers.giphy.com) and restart the server."
          : "Couldn't load. Check your connection.");
      } finally {
        if (my === seq.current) setLoading(false);
      }
    }, cached ? 0 : q ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, type]);

  async function more() {
    if (loading || !hasMore) return;
    const my = seq.current;
    setLoading(true);
    try {
      const body = await loadGifs(type, query.trim(), items.length);
      if (my !== seq.current) return;
      setItems((cur) => [...cur, ...(body.items || []).filter((g) => !cur.some((c) => c.id === g.id))]);
      setHasMore(!!body.hasMore);
    } catch { /* keep what we have */ } finally { setLoading(false); }
  }

  return (
    <div className={`gif-tab ${sticker ? "is-sticker" : ""}`}>
      <div className="gif-search">
        <SearchIcon size={15} />
        <input placeholder={sticker ? "Search stickers" : "Search GIFs"} value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <button type="button" className="icon-btn btn-sm" onClick={() => setQuery("")}>
            <CloseIcon size={13} />
          </button>
        )}
      </div>
      {error && <div className="emoji-panel-empty"><p>{error}</p></div>}
      <div
        className="gif-masonry"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 300) more();
        }}
      >
        {loading && !items.length && !error &&
          Array.from({ length: 12 }).map((_, i) => <div key={i} className="skeleton gif-skel" style={{ aspectRatio: `${1 + (i % 3) * 0.3}` }} />)}
        {items.map((g) => (
          <button
            key={g.id}
            type="button"
            className="gif-tile"
            title={g.title}
            // the tile has the GIF's real shape before it loads, so nothing jumps or gets squashed
            style={{ aspectRatio: `${g.width} / ${g.height}`, backgroundImage: g.still && !sticker ? `url(${g.still})` : undefined }}
            onClick={() => onPick(g.url, g.title)}
          >
            <img src={g.preview || g.url} alt={g.title} loading="lazy" decoding="async" draggable={false} />
          </button>
        ))}
        {!loading && !items.length && !error && <p className="emoji-panel-hint">Nothing found.</p>}
      </div>
      {!!items.length && <div className="gif-attrib">Powered by GIPHY</div>}
    </div>
  );
}

// Category order + labels copied from WhatsApp Web (clock = Recent first).
const WA_CATEGORIES = [
  { category: Categories.SUGGESTED, name: "Recent" },
  { category: Categories.SMILEYS_PEOPLE, name: "Smileys & People" },
  { category: Categories.ANIMALS_NATURE, name: "Animals & Nature" },
  { category: Categories.FOOD_DRINK, name: "Food & Drink" },
  { category: Categories.ACTIVITIES, name: "Activities" },
  { category: Categories.TRAVEL_PLACES, name: "Travel & Places" },
  { category: Categories.OBJECTS, name: "Objects" },
  { category: Categories.SYMBOLS, name: "Symbols" },
  { category: Categories.FLAGS, name: "Flags" },
];

export default function EmojiPanel({ onEmoji, onGif, docked }) {
  const [tab, setTab] = useState("emoji");
  useEffect(() => { prefetchTrending(); }, []);

  function pick(emoji) {
    pushRecentEmoji(emoji);
    onEmoji(emoji);
  }

  return (
    <div className={`emoji-panel wa-panel ${docked ? "docked" : ""}`}>
      <div className="wa-panel-body">
        {tab === "emoji" && (
          <EmojiPicker
            theme="dark"
            // Native glyphs: no CDN fetch, so it works offline and isn't
            // blocked by tracking-prevention.
            emojiStyle={EmojiStyle.NATIVE}
            suggestedEmojisMode={SuggestionMode.RECENT}
            categories={WA_CATEGORIES}
            searchPlaceHolder="Search emoji"
            autoFocusSearch={false}
            onEmojiClick={(e) => pick(e.emoji)}
            width="100%"
            height="100%"
            lazyLoadEmojis
            skinTonesDisabled
            previewConfig={{ showPreview: false }}
          />
        )}

        {tab === "gif" && <GifTab type="gifs" onPick={(url, title) => onGif(url, title, false)} />}

        {tab === "sticker" && <GifTab type="stickers" onPick={(url, title) => onGif(url, title, true)} />}
      </div>

      {/* WhatsApp-style segmented switch pinned at the bottom */}
      <div className="wa-switch" role="tablist" aria-label="Emoji, GIF and sticker">
        <button type="button" role="tab" aria-selected={tab === "emoji"} aria-label="Emoji" className={tab === "emoji" ? "active" : ""} onClick={() => setTab("emoji")}>
          <SmileIcon size={20} />
        </button>
        <button type="button" role="tab" aria-selected={tab === "gif"} aria-label="GIF" className={`gif ${tab === "gif" ? "active" : ""}`} onClick={() => setTab("gif")}>
          GIF
        </button>
        <button type="button" role="tab" aria-selected={tab === "sticker"} aria-label="Stickers" className={tab === "sticker" ? "active" : ""} onClick={() => setTab("sticker")}>
          <StickerIcon size={20} />
        </button>
      </div>
    </div>
  );
}
