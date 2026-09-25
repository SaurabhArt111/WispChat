import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { mediaUrl } from "../api/config";

/**
 * Decrypts a message's text (if it's encrypted) for display. Non-encrypted
 * messages resolve instantly with their plain text. While encryption is
 * locked (page freshly refreshed, password not re-entered yet) or this
 * device can't read this particular message, `locked` is true and `text`
 * is empty — callers should show a "tap to unlock" style placeholder
 * rather than blank space.
 */
export function useDecryptedText(message) {
  const { e2ee } = useAuth();
  const [state, setState] = useState(() =>
    message?.encrypted ? { text: "", locked: true, loading: true } : { text: message?.text || "", locked: false, loading: false }
  );

  useEffect(() => {
    let cancelled = false;
    if (!message?.encrypted) {
      setState({ text: message?.text || "", locked: false, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    e2ee.decryptMessageText(message).then(({ text, locked }) => {
      if (!cancelled) setState({ text, locked, loading: false });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?._id, message?.text, message?.iv, message?.encrypted, e2ee.ready]);

  return state;
}

const objectUrlCache = new Map(); // attachment url -> blob object URL, for this session only

/**
 * Resolves the src/href to actually put on an <img>/<video>/<audio>/<a>
 * for an attachment. For a plain (unencrypted) attachment this is just
 * the direct media URL. For an encrypted one, it fetches the ciphertext,
 * decrypts it in-memory with the message's key, and hands back a
 * short-lived blob: URL.
 */
export function useDecryptedMediaUrl(message, attachment) {
  const { e2ee } = useAuth();
  const plainUrl = attachment?.url ? mediaUrl(attachment.url) : null;
  const [state, setState] = useState(() =>
    attachment?.encrypted ? { url: null, loading: true, error: false } : { url: plainUrl, loading: false, error: false }
  );

  useEffect(() => {
    let cancelled = false;

    if (!attachment?.encrypted) {
      setState({ url: plainUrl, loading: false, error: false });
      return;
    }

    const cacheKey = `${attachment.url}:${attachment.iv}`;
    const cached = objectUrlCache.get(cacheKey);
    if (cached) {
      setState({ url: cached, loading: false, error: false });
      return;
    }

    setState({ url: null, loading: true, error: false });
    (async () => {
      try {
        const { mk, locked } = await e2ee.decryptMessageText(message);
        if (locked || !mk) throw new Error("locked");
        const res = await fetch(plainUrl);
        const buffer = await res.arrayBuffer();
        const plainBuffer = await e2ee.decryptAttachmentBuffer(mk, buffer, attachment.iv);
        const blob = new Blob([plainBuffer], { type: attachment.mimeType || "application/octet-stream" });
        const objectUrl = URL.createObjectURL(blob);
        objectUrlCache.set(cacheKey, objectUrl);
        if (!cancelled) setState({ url: objectUrl, loading: false, error: false });
      } catch (err) {
        if (!cancelled) setState({ url: null, loading: false, error: true });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment?.url, attachment?.iv, attachment?.encrypted, e2ee.ready]);

  return state;
}
