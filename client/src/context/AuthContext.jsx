import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import client from "../api/client";
import {
  generateIdentityKeyPair,
  wrapPrivateKeyWithPassword,
  unwrapPrivateKeyWithPassword,
  generateMessageKey,
  wrapMessageKeyForRecipient,
  unwrapMessageKeyFromSender,
  encryptTextWithKey,
  decryptTextWithKey,
  encryptBytesWithKey,
  decryptBytesWithKey,
  cacheWrapPrivateKey,
  cacheUnwrapPrivateKey,
} from "../utils/crypto";
import { logError } from "../utils/logger";
import { clearCache as clearMessageCache } from "../utils/messageCache";
import { clearDecryptCache, peekDecrypted, storeDecrypted } from "../utils/decryptCache";

const AuthContext = createContext(null);

function cacheKeyName(userId) {
  return `wisp_e2ee_cache_${userId}`;
}

async function saveLocalKeyCache(userId, privateKey, token) {
  try {
    const wrapped = await cacheWrapPrivateKey(privateKey, token);
    localStorage.setItem(cacheKeyName(userId), JSON.stringify(wrapped));
  } catch (err) {
    // Non-fatal — worst case, the person is asked to unlock with their
    // password on the next refresh instead of it happening silently.
    logError("e2ee cache", err);
  }
}

async function loadLocalKeyCache(userId, token) {
  const raw = localStorage.getItem(cacheKeyName(userId));
  if (!raw) return null;
  try {
    return await cacheUnwrapPrivateKey(token, JSON.parse(raw));
  } catch {
    localStorage.removeItem(cacheKeyName(userId));
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // The unlocked ECDH private key lives ONLY in memory for this tab's
  // session — never in localStorage/IndexedDB. That's the whole point:
  // the account's encryption identity is recoverable from the *server*
  // (via the wrapped bundle keyed to this user id) plus the person's
  // password, from any device, rather than being pinned to one device's
  // storage. The tradeoff is that a page refresh forgets it — restoring it
  // then relies on the local key cache (loadLocalKeyCache below); if that's
  // missing, the person is sent back to sign in rather than prompted here.
  const privateKeyRef = useRef(null);
  const [e2eeReady, setE2eeReady] = useState(false);
  // Shown on the sign-in screen when a saved session can't be used as-is —
  // this replaces the old post-login "Unlock your secure chats" popup:
  // login now unlocks encryption in the same step (see login(), below), so
  // there's nothing left to prompt for after the app is showing.
  const [sessionNotice, setSessionNotice] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("wisp_token");
    if (!token) {
      setLoading(false);
      return;
    }
    client
      .get("/auth/me")
      .then(async (res) => {
        // A saved session whose encryption key can't be restored silently
        // (no local key cache — e.g. the session predates it, or it was
        // cleared) is sent back to the sign-in screen. The password typed
        // there unlocks everything in one step, so there is never a second
        // "unlock your chats" prompt on top of logging in.
        const backToSignIn = () => {
          localStorage.removeItem("wisp_token");
          setUser(null);
          setSessionNotice("Please sign in again to unlock your encrypted chats on this device.");
        };

        if (res.data.needsE2EESetup) return backToSignIn();
        if (!res.data.user?.e2ee?.publicKeyJwk) {
          setUser(res.data.user);
          return;
        }

        const cached = await loadLocalKeyCache(res.data.user._id, token);
        if (!cached) return backToSignIn();

        privateKeyRef.current = cached;
        setUser(res.data.user);
        setE2eeReady(true);
      })
      .catch(() => localStorage.removeItem("wisp_token"))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (identifier, password) => {
    if (!window.crypto?.subtle) {
      throw new Error(
        "Secure chats need a secure connection (HTTPS or localhost). Open Wisp over https:// and try again."
      );
    }
    const res = await client.post("/auth/login", { identifier, password });

    // Unlock BEFORE the app sees a signed-in user, so chats never render in
    // a half-locked state ("Couldn't decrypt") for a moment after login.
    let ok;
    if (res.data.needsE2EESetup) {
      // Legacy/first-run account with no keypair yet — generate one now
      // and register it, using the password already in hand.
      localStorage.setItem("wisp_token", res.data.token);
      ok = await setupEncryption(res.data.user, password, res.data.token);
    } else {
      ok = await unlockEncryption(res.data.user, password, res.data.token);
    }
    if (!ok) {
      localStorage.removeItem("wisp_token");
      throw new Error("Signed in, but your encrypted chats couldn't be unlocked. Please try again.");
    }
    localStorage.setItem("wisp_token", res.data.token);
    setSessionNotice("");
    setUser(res.data.user);
    return res.data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const { keyPair, publicKeyJwk } = await generateIdentityKeyPair();
    const wrapped = await wrapPrivateKeyWithPassword(keyPair.privateKey, payload.password);
    const res = await client.post("/auth/register", {
      ...payload,
      e2ee: { publicKeyJwk, ...wrapped },
    });
    localStorage.setItem("wisp_token", res.data.token);
    setUser(res.data.user);
    privateKeyRef.current = keyPair.privateKey;
    setE2eeReady(true);
    await saveLocalKeyCache(res.data.user._id, keyPair.privateKey, res.data.token);
    return res.data.user;
  }, []);

  const unlockEncryption = useCallback(async (currentUser, password, token) => {
    try {
      const bundle = currentUser?.e2ee;
      if (!bundle?.wrappedPrivateKey) return false;
      const privateKey = await unwrapPrivateKeyWithPassword(password, bundle);
      privateKeyRef.current = privateKey;
      setE2eeReady(true);
      await saveLocalKeyCache(currentUser._id, privateKey, token || localStorage.getItem("wisp_token"));
      return true;
    } catch (err) {
      logError("e2ee unlock", err);
      return false;
    }
  }, []);

  const setupEncryption = useCallback(async (currentUser, password, token) => {
    const { keyPair, publicKeyJwk } = await generateIdentityKeyPair();
    const wrapped = await wrapPrivateKeyWithPassword(keyPair.privateKey, password);
    const res = await client.post("/auth/e2ee-setup", { publicKeyJwk, ...wrapped });
    setUser(res.data.user);
    privateKeyRef.current = keyPair.privateKey;
    setE2eeReady(true);
    await saveLocalKeyCache(res.data.user._id, keyPair.privateKey, token || localStorage.getItem("wisp_token"));
    return true;
  }, []);

  const logout = useCallback(async () => {
    try {
      await client.post("/auth/logout");
    } catch (e) {
      /* ignore */
    }
    if (user?._id) localStorage.removeItem(cacheKeyName(user._id));
    if (user?._id) clearMessageCache(user._id);
    clearDecryptCache();
    localStorage.removeItem("wisp_token");
    setUser(null);
    privateKeyRef.current = null;
    setE2eeReady(false);
  }, [user]);

  // ---------------- E2EE message helpers ----------------
  // These are exposed as `e2ee.*` on the context and are the only place
  // in the app that touches the raw private key — everything else deals
  // in conversation/message objects.

  const prepareEnvelope = useCallback(
    async (conversation) => {
      if (!privateKeyRef.current || !user) return { canEncrypt: false };
      const participants = conversation?.participants || [];
      const recipients = new Map();
      for (const p of participants) {
        const pubJwk = p?.e2ee?.publicKeyJwk;
        if (!pubJwk) return { canEncrypt: false }; // one contact hasn't set up encryption yet
        recipients.set(String(p._id), pubJwk);
      }
      if (user.e2ee?.publicKeyJwk) recipients.set(String(user._id), user.e2ee.publicKeyJwk);
      if (recipients.size === 0) return { canEncrypt: false };

      const mk = await generateMessageKey();
      const keys = await Promise.all(
        Array.from(recipients.entries()).map(async ([userId, pubJwk]) => {
          const { wrappedKey, keyIv } = await wrapMessageKeyForRecipient(mk, privateKeyRef.current, pubJwk);
          return { user: userId, wrappedKey, keyIv };
        })
      );
      return { canEncrypt: true, mk, keys };
    },
    [user]
  );

  const encryptOutgoingText = useCallback(async (envelope, text) => {
    if (!envelope?.canEncrypt) return { text, encrypted: false, iv: null, keys: [] };
    const { ciphertext, iv } = await encryptTextWithKey(envelope.mk, text || "");
    return { text: ciphertext, encrypted: true, iv, keys: envelope.keys };
  }, []);

  const encryptOutgoingBytes = useCallback(async (envelope, arrayBuffer) => {
    if (!envelope?.canEncrypt) return { buffer: arrayBuffer, encrypted: false, iv: null };
    const { ciphertext, iv } = await encryptBytesWithKey(envelope.mk, arrayBuffer);
    return { buffer: ciphertext, encrypted: true, iv };
  }, []);

  // Returns { text, locked, mk } — `locked` means we couldn't read it
  // (encryption not unlocked yet, or we're not a recipient of this
  // message's key envelope). `mk`, when present, can be reused to also
  // decrypt this message's attachments without re-deriving anything.
  const decryptMessageText = useCallback(
    async (message) => {
      if (!message?.encrypted) return { text: message?.text || "", locked: false };
      if (!privateKeyRef.current || !user) return { text: "", locked: true };
      const hit = peekDecrypted(message);
      if (hit) return hit;
      const myEntry = (message.keys || []).find((k) => String(k.user?._id || k.user) === String(user._id));
      const senderPub = message.sender?.e2ee?.publicKeyJwk;
      if (!myEntry || !senderPub) return { text: "", locked: true };
      let mk;
      try {
        mk = await unwrapMessageKeyFromSender(myEntry.wrappedKey, myEntry.keyIv, privateKeyRef.current, senderPub);
      } catch (err) {
        logError("e2ee decrypt", err);
        return { text: "", locked: true };
      }
      // The message key is what actually matters for callers decrypting an
      // attachment (useDecryptedMediaUrl) — the caption/text below is a
      // separate, often-empty field (an attachment with no caption still
      // has a valid `mk` and `iv`, but decrypting "" isn't always
      // meaningful). A caption-decrypt failure shouldn't take the whole
      // call down and withhold `mk` from an attachment that would
      // otherwise decrypt just fine.
      try {
        const text = message.iv && message.text ? await decryptTextWithKey(mk, message.text, message.iv) : "";
        const result = { text, locked: false, mk };
        storeDecrypted(message, result);
        return result;
      } catch (err) {
        logError("e2ee decrypt", err);
        return { text: "", locked: false, mk };
      }
    },
    [user]
  );

  const decryptAttachmentBuffer = useCallback(async (mk, arrayBuffer, ivB64) => {
    return decryptBytesWithKey(mk, arrayBuffer, ivB64);
  }, []);

  const value = {
    user,
    setUser,
    loading,
    sessionNotice,
    clearSessionNotice: () => setSessionNotice(""),
    login,
    register,
    logout,
    e2ee: {
      ready: e2eeReady,
      myPublicKeyJwk: user?.e2ee?.publicKeyJwk || null,
      prepareEnvelope,
      encryptOutgoingText,
      encryptOutgoingBytes,
      decryptMessageText,
      decryptAttachmentBuffer,
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
