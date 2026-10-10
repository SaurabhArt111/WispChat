// Link detection shared by chat bubbles, link-preview cards and the
// Media → Links tab. Handles http(s):// URLs, www. links and bare domains on
// common TLDs (so "wisp.chat" style text still becomes tappable) while
// ignoring e-mail addresses and file names like "index.js".
const TLDS =
  "com|org|net|io|in|co|dev|app|me|ly|gg|tv|ai|xyz|info|edu|gov|ac|uk|us|ca|de|fr|jp|ru|cn|au|biz|online|site|tech|store|link|page|live|cloud|chat|so|to|fm|be";

export const URL_PATTERN =
  String.raw`(?:https?:\/\/|www\.)[^\s<>"']+|(?<![@\w.\-\/])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:${TLDS})(?![\w@-])(?:[\/?#][^\s<>"']*)?`;

export function makeUrlRegex(flags = "gi") {
  return new RegExp(URL_PATTERN, flags);
}

const TRAILING = /[.,!?:;'"\]}>]+$/;

// "https://a.com/x)." -> { url: "https://a.com/x", trailing: ")." } (keeps a
// closing paren only when the URL itself contains the matching "(").
export function splitTrailing(raw) {
  let url = raw;
  let trailing = "";
  for (;;) {
    const m = url.match(TRAILING);
    if (m) {
      trailing = m[0] + trailing;
      url = url.slice(0, -m[0].length);
      continue;
    }
    if (url.endsWith(")") && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
      trailing = ")" + trailing;
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return { url, trailing };
}

export function toHref(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export function isUrlToken(token) {
  if (!token) return false;
  const re = makeUrlRegex("i");
  const m = token.match(re);
  return !!m && m.index === 0 && m[0].length === token.length;
}

// All distinct links in a piece of text, in order, as clean hrefs.
export function extractUrls(text) {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  const re = makeUrlRegex("gi");
  let m;
  while ((m = re.exec(text))) {
    const { url } = splitTrailing(m[0]);
    if (!url) continue;
    const href = toHref(url);
    if (!seen.has(href)) {
      seen.add(href);
      out.push(href);
    }
  }
  return out;
}

export function hostOf(href) {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

// True when a message is nothing but 1–3 emoji (rendered large, sticker-like).
export function isEmojiOnly(text) {
  const t = (text || "").trim();
  if (!t || t.length > 24) return false;
  const stripped = t.replace(/\s/g, "");
  const emojiRe = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)+$/u;
  if (!emojiRe.test(stripped)) return false;
  const count = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(stripped)].length;
  return count <= 3;
}
