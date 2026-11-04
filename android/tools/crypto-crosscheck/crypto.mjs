/**
 * End-to-end encryption primitives, built entirely on the browser's native
 * WebCrypto (SubtleCrypto) API — no third-party crypto library needed.
 *
 * Design in one paragraph: every account has an ECDH (P-256) identity
 * keypair. The public key is handed to the server freely (it's how other
 * people encrypt *to* you). The private key is exported, wrapped
 * (encrypted) with a key derived from your password via PBKDF2, and it's
 * that *wrapped* blob — not the key itself — that's stored server-side
 * against your account. That means the private key never sits on the
 * server in a usable form, but it's also not tied to one device: log in
 * on a new phone, the server hands you the same wrapped blob, your
 * password unwraps it there too.
 *
 * Every message gets its own random AES-256 key ("mk"). The sender
 * encrypts the text/attachments with mk, then wraps mk once per
 * recipient (including themself, so their own history stays readable)
 * using an ECDH-derived shared secret with that recipient — the same
 * envelope scheme works whether there are 2 participants or 20.
 *
 * IMPORTANT SCOPE NOTE: this gives every message genuine confidentiality
 * against the server (it only ever sees ciphertext), but it is a
 * simplified scheme, not a full Signal-style double ratchet — there's no
 * per-message forward-secrecy ratcheting or deniability. Good enough to
 * keep a chat server from being able to read your messages; not audited
 * for adversarial, high-stakes use.
 */

const ECDH_PARAMS = { name: "ECDH", namedCurve: "P-256" };
const HKDF_SALT = new TextEncoder().encode("wispchat-e2ee-v1");
const HKDF_INFO = new TextEncoder().encode("wispchat-message-key-wrap");

function assertCrypto() {
  if (!window.crypto?.subtle) {
    throw new Error(
      "Encryption isn't available in this browser context (WebCrypto requires HTTPS, or http://localhost)."
    );
  }
}

// ---------- base64 helpers ----------
export function bufToB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function b64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function randomBytes(len) {
  return window.crypto.getRandomValues(new Uint8Array(len));
}

// ---------- identity keypair ----------
export async function generateIdentityKeyPair() {
  assertCrypto();
  const keyPair = await window.crypto.subtle.generateKey(ECDH_PARAMS, true, ["deriveBits"]);
  const publicKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return { keyPair, publicKeyJwk };
}

export async function importPublicKey(publicKeyJwk) {
  return window.crypto.subtle.importKey("jwk", publicKeyJwk, ECDH_PARAMS, false, []);
}

// ---------- password-based wrapping of the private key ----------
export async function deriveKekFromPassword(password, saltB64, iterations) {
  assertCrypto();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(b64ToBuf(saltB64)), iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export const DEFAULT_KDF_ITERATIONS = 210000;

export async function wrapPrivateKeyWithPassword(privateKey, password) {  assertCrypto();
  const saltBytes = randomBytes(16);
  const saltB64 = bufToB64(saltBytes);
  const kek = await deriveKekFromPassword(password, saltB64, DEFAULT_KDF_ITERATIONS);

  const jwk = await window.crypto.subtle.exportKey("jwk", privateKey);
  const plaintext = new TextEncoder().encode(JSON.stringify(jwk));
  const iv = randomBytes(12);
  const wrapped = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, plaintext);

  return {
    wrappedPrivateKey: bufToB64(wrapped),
    wrapIv: bufToB64(iv),
    kdfSalt: saltB64,
    kdfIterations: DEFAULT_KDF_ITERATIONS,
  };
}

export async function unwrapPrivateKeyWithPassword(password, { wrappedPrivateKey, wrapIv, kdfSalt, kdfIterations }) {
  assertCrypto();
  const kek = await deriveKekFromPassword(password, kdfSalt, kdfIterations);
  const plaintext = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(b64ToBuf(wrapIv)) },
    kek,
    b64ToBuf(wrappedPrivateKey)
  );
  const jwk = JSON.parse(new TextDecoder().decode(plaintext));
  // extractable: true — not a security downgrade (this key only ever
  // lives in page memory either way, there's no HSM boundary being
  // crossed), but it IS required: cacheWrapPrivateKey below needs to
  // re-export this key to build the local refresh-survives cache. A
  // mismatch here (this used to import as non-extractable while the
  // fresh-registration path imported as extractable) is exactly what
  // caused caching to silently fail after every *login*, which is why
  // the unlock prompt kept reappearing on every reload instead of only
  // once per browser.
  return window.crypto.subtle.importKey("jwk", jwk, ECDH_PARAMS, true, ["deriveBits"]);
}

// ---------- local (per-browser) convenience cache ----------
// The server-stored bundle above is what makes the identity recoverable
// on any device (with the password). Separately, once a private key has
// been unlocked once in this browser, we cache it locally — wrapped with
// a key derived from the session's own JWT, which is itself a secret only
// this browser holds — so a plain page refresh doesn't need to ask for
// the password again. A brand new browser/device still needs the
// password once, the same moment it already needs it to log in at all;
// this cache just removes the *separate*, repeated prompt on top of that.
export async function deriveKekFromToken(token) {
  assertCrypto();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: new TextEncoder().encode("wispchat-local-key-cache") },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function cacheWrapPrivateKey(privateKey, token) {
  const kek = await deriveKekFromToken(token);
  const jwk = await window.crypto.subtle.exportKey("jwk", privateKey);
  const plaintext = new TextEncoder().encode(JSON.stringify(jwk));
  const iv = randomBytes(12);
  const wrapped = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, plaintext);
  return { wrapped: bufToB64(wrapped), iv: bufToB64(iv) };
}

export async function cacheUnwrapPrivateKey(token, { wrapped, iv }) {
  const kek = await deriveKekFromToken(token);
  const plaintext = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(b64ToBuf(iv)) },
    kek,
    b64ToBuf(wrapped)
  );
  const jwk = JSON.parse(new TextDecoder().decode(plaintext));
  // Same extractable: true as unwrapPrivateKeyWithPassword above, and for
  // the same reason — consistency here is what prevents this whole class
  // of "silently failed to export" bug from resurfacing.
  return window.crypto.subtle.importKey("jwk", jwk, ECDH_PARAMS, true, ["deriveBits"]);
}

// ---------- pairwise shared-key derivation (ECDH + HKDF) ----------
async function deriveSharedAesKey(myPrivateKey, theirPublicKeyJwk) {
  const theirPublicKey = await importPublicKey(theirPublicKeyJwk);
  const sharedBits = await window.crypto.subtle.deriveBits(
    { name: "ECDH", public: theirPublicKey },
    myPrivateKey,
    256
  );
  const hkdfKey = await window.crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  return window.crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HKDF_INFO },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ---------- per-message key ----------
export async function generateMessageKey() {
  return window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function wrapMessageKeyForRecipient(mk, myPrivateKey, recipientPublicKeyJwk) {
  const raw = await window.crypto.subtle.exportKey("raw", mk);
  const sharedKey = await deriveSharedAesKey(myPrivateKey, recipientPublicKeyJwk);
  const iv = randomBytes(12);
  const wrapped = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, raw);
  return { wrappedKey: bufToB64(wrapped), keyIv: bufToB64(iv) };
}

export async function unwrapMessageKeyFromSender(wrappedKeyB64, keyIvB64, myPrivateKey, senderPublicKeyJwk) {
  const sharedKey = await deriveSharedAesKey(myPrivateKey, senderPublicKeyJwk);
  const raw = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(b64ToBuf(keyIvB64)) },
    sharedKey,
    b64ToBuf(wrappedKeyB64)
  );
  return window.crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

// ---------- payload encryption under a message key ----------
export async function encryptTextWithKey(mk, text) {
  const iv = randomBytes(12);
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    mk,
    new TextEncoder().encode(text)
  );
  return { ciphertext: bufToB64(ciphertext), iv: bufToB64(iv) };
}

export async function decryptTextWithKey(mk, ciphertextB64, ivB64) {
  const plaintext = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(b64ToBuf(ivB64)) },
    mk,
    b64ToBuf(ciphertextB64)
  );
  return new TextDecoder().decode(plaintext);
}

export async function encryptBytesWithKey(mk, arrayBuffer) {
  const iv = randomBytes(12);
  const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, mk, arrayBuffer);
  return { ciphertext, iv: bufToB64(iv) };
}

export async function decryptBytesWithKey(mk, arrayBuffer, ivB64) {
  return window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(b64ToBuf(ivB64)) },
    mk,
    arrayBuffer
  );
}
