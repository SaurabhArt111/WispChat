globalThis.window = globalThis;
import * as c from "./crypto.mjs";
import fs from "fs";
const web = JSON.parse(fs.readFileSync("web.json","utf8"));
const k = JSON.parse(fs.readFileSync("kotlin.json","utf8"));
// 1. web unlocks the private key Kotlin wrapped
const priv = await c.unwrapPrivateKeyWithPassword(k.pw, k.wrap);
// 2. web decrypts a message Kotlin wrote (sender = Kotlin identity, recipient = same identity)
const mk = await c.unwrapMessageKeyFromSender(k.key.wrappedKey, k.key.keyIv, priv, k.pub);
const text = await c.decryptTextWithKey(mk, k.ct, k.iv);
if (text !== k.text) throw new Error("text mismatch: " + text);
const bytes = new Uint8Array(await c.decryptBytesWithKey(mk, c.b64ToBuf(k.bytes), k.bytesIv));
if (bytes.join() !== "9,8,7,255,0") throw new Error("bytes mismatch " + bytes.join());
// 3. Kotlin public JWK is accepted by WebCrypto
await c.importPublicKey(k.pub);
console.log("WEB ACCEPTS KOTLIN OUTPUT: OK ->", text);
