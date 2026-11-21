import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

// GIF + sticker search for the apps, proxied through the server so the GIPHY key
// never ships inside the Android app. Set GIPHY_API_KEY in server/.env (free key:
// https://developers.giphy.com). Without it the endpoint answers 503 and the app
// shows how to turn it on.
const router = Router();
router.use(requireAuth);

const cache = new Map(); // tiny in-memory cache: trending changes slowly, searches repeat a lot
const TTL_MS = 10 * 60 * 1000;

function shape(g) {
  const img = g.images || {};
  const small = img.fixed_width || img.fixed_width_downsampled || img.downsized || img.original || {};
  const full = img.downsized_medium || img.downsized || img.original || small;
  return {
    id: g.id,
    title: g.title || "",
    preview: small.webp || small.url || "",
    url: full.url || small.url || "",
    width: Number(small.width) || 200,
    height: Number(small.height) || 200,
  };
}

// GET /api/gifs?type=gifs|stickers&q=cats&offset=0
router.get("/", async (req, res) => {
  const key = process.env.GIPHY_API_KEY;
  if (!key) return res.status(503).json({ message: "GIF search isn't set up: add GIPHY_API_KEY to the server's .env", setup: true });
  const type = req.query.type === "stickers" ? "stickers" : "gifs";
  const q = String(req.query.q || "").trim().slice(0, 80);
  const offset = Math.max(0, Math.min(4000, parseInt(req.query.offset, 10) || 0));
  const url = q
    ? `https://api.giphy.com/v1/${type}/search?api_key=${key}&q=${encodeURIComponent(q)}&limit=30&offset=${offset}&rating=pg-13`
    : `https://api.giphy.com/v1/${type}/trending?api_key=${key}&limit=30&offset=${offset}&rating=pg-13`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return res.json(hit.body);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(502).json({ message: "GIF service unavailable" });
    const data = await r.json();
    const body = { items: (data.data || []).map(shape).filter((g) => g.url), hasMore: (data.pagination?.total_count || 0) > offset + 30 };
    cache.set(url, { at: Date.now(), body });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    res.json(body);
  } catch {
    res.status(502).json({ message: "GIF service unavailable" });
  }
});

export default router;
