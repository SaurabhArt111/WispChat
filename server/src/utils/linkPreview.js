import dns from "dns/promises";
import net from "net";

// ---------------------------------------------------------------------------
// Link preview fetcher (WhatsApp-style cards: title, description, image).
//
// This endpoint fetches arbitrary URLs on behalf of users, so it is a classic
// SSRF vector. Safeguards:
//  - only http/https, default ports 80/443/8080/8443
//  - the hostname is resolved first and every resolved address must be public
//    (no loopback / private / link-local / CGNAT / multicast / metadata IPs)
//  - redirects are followed manually (max 4) and re-validated at every hop
//  - hard timeout and a response-size cap (we only need the <head>)
// ---------------------------------------------------------------------------

const MAX_BYTES = 600 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 4;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();

function isPrivateIPv4(ip) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(ip) {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique local
  if (v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true; // link-local
  if (v.startsWith("ff")) return true; // multicast
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
}

async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported protocol");
  if (url.username || url.password) throw new Error("Credentials in URL not allowed");
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (!["80", "443", "8080", "8443"].includes(port)) throw new Error("Port not allowed");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("Address not allowed");
  } else {
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
      throw new Error("Address not allowed");
    }
    const records = await dns.lookup(host, { all: true });
    if (!records.length || records.some((r) => isPrivateAddress(r.address))) {
      throw new Error("Address not allowed");
    }
  }
  return url;
}

async function fetchWithGuards(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          // Many sites only serve OpenGraph tags to link-unfurling bots.
          "User-Agent": "Mozilla/5.0 (compatible; WispChatLinkPreview/1.0; +https://wisp.chat)",
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "Accept-Language": "en",
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location"), url).toString();
      continue;
    }
    return { res, finalUrl: url.toString() };
  }
  throw new Error("Too many redirects");
}

async function readCapped(res) {
  const reader = res.body?.getReader?.();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    // The <head> is all we need — stop early once it has closed.
    const tail = Buffer.concat(chunks).toString("utf8");
    if (/<\/head>/i.test(tail)) break;
  }
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
  return Buffer.concat(chunks).toString("utf8");
}

function decodeEntities(str = "") {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

function metaMap(html) {
  const map = {};
  const tagRe = /<meta\s+[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    if (key && content && map[key] === undefined) map[key] = decodeEntities(content[1] ?? content[2] ?? "");
  }
  return map;
}

function absolutize(maybe, base) {
  if (!maybe) return "";
  try {
    const u = new URL(maybe, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

export async function getLinkPreview(rawUrl) {
  const key = String(rawUrl).trim();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;

  const { res, finalUrl } = await fetchWithGuards(key);
  const host = new URL(finalUrl).hostname.replace(/^www\./, "");
  const type = res.headers.get("content-type") || "";

  let data;
  if (type.startsWith("image/")) {
    data = { url: finalUrl, host, title: finalUrl.split("/").pop() || host, description: "", image: finalUrl, siteName: host, kind: "image" };
  } else if (!/html|xml/i.test(type)) {
    data = {
      url: finalUrl,
      host,
      title: decodeURIComponent(finalUrl.split("/").pop() || host),
      description: type ? `${type.split(";")[0]} file` : "",
      image: "",
      siteName: host,
      kind: "file",
    };
  } else {
    const html = await readCapped(res);
    const meta = metaMap(html);
    const titleTag = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "");
    const icon = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1];
    data = {
      url: finalUrl,
      host,
      title: meta["og:title"] || meta["twitter:title"] || titleTag || host,
      description: (meta["og:description"] || meta["twitter:description"] || meta.description || "").slice(0, 300),
      image: absolutize(meta["og:image"] || meta["og:image:url"] || meta["twitter:image"] || meta["twitter:image:src"], finalUrl),
      favicon: absolutize(icon || "/favicon.ico", finalUrl),
      siteName: meta["og:site_name"] || host,
      kind: "page",
    };
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
  return data;
}
