globalThis.window = globalThis;
import * as c from "./crypto.mjs";
import fs from "fs";
const pw = "pässwörd-日本-1";
const A = await c.generateIdentityKeyPair();
const B = await c.generateIdentityKeyPair();
const wrapA = await c.wrapPrivateKeyWithPassword(A.keyPair.privateKey, pw);
const wrapB = await c.wrapPrivateKeyWithPassword(B.keyPair.privateKey, pw);
const mk = await c.generateMessageKey();
const text = "héllo 🌍 from the web";
const enc = await c.encryptTextWithKey(mk, text);
const kA = await c.wrapMessageKeyForRecipient(mk, A.keyPair.privateKey, A.publicKeyJwk);
const kB = await c.wrapMessageKeyForRecipient(mk, A.keyPair.privateKey, B.publicKeyJwk);
const bytes = new Uint8Array([1,2,3,250,251,252]);
const eb = await c.encryptBytesWithKey(mk, bytes.buffer);
fs.writeFileSync("web.json", JSON.stringify({pw, A:A.publicKeyJwk, B:B.publicKeyJwk, wrapA, wrapB, text, enc, kA, kB,
  bytes: c.bufToB64(eb.ciphertext), bytesIv: eb.iv}));
console.log("web vectors written");
const flat = {
  pw, Ax:A.publicKeyJwk.x, Ay:A.publicKeyJwk.y, Bx:B.publicKeyJwk.x, By:B.publicKeyJwk.y,
  wrapA_ct:wrapA.wrappedPrivateKey, wrapA_iv:wrapA.wrapIv, wrapA_salt:wrapA.kdfSalt, wrapA_it:String(wrapA.kdfIterations),
  wrapB_ct:wrapB.wrappedPrivateKey, wrapB_iv:wrapB.wrapIv, wrapB_salt:wrapB.kdfSalt, wrapB_it:String(wrapB.kdfIterations),
  text, ct:enc.ciphertext, iv:enc.iv, kA_w:kA.wrappedKey, kA_iv:kA.keyIv, kB_w:kB.wrappedKey, kB_iv:kB.keyIv,
  bytes:c.bufToB64(eb.ciphertext), bytesIv:eb.iv,
};
fs.writeFileSync("web.txt", Object.entries(flat).map(([k,v])=>k+"\t"+v).join("\n"));
