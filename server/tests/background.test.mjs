import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import esmock from "esmock";
import { Server } from "socket.io";
import { io as connect } from "socket.io-client";

const SRC = new URL("../src/", import.meta.url).pathname;
process.env.JWT_SECRET = "test-secret";
const { signToken } = await import(`${SRC}utils/jwt.js`);

// Firebase is NOT configured here (no service account): everything must work through the background socket.
const users = {
  alice: { _id: "alice", displayName: "Alice", avatar: "", avatarColor: "#fff", pushTokens: [] },
  bob: { _id: "bob", displayName: "Bob", avatar: "", avatarColor: "#fff", pushTokens: [] },
  carol: { _id: "carol", displayName: "Carol", avatar: "", avatarColor: "#fff", pushTokens: [] },
};
const presence = [];
const User = {
  findById: (id) => { const u = users[String(id)]; const p = Promise.resolve(u); p.select = () => Promise.resolve(u); return p; },
  findByIdAndUpdate: async (id, patch) => { presence.push({ id, ...patch }); },
  find: () => ({ select: () => ({ lean: async () => [] }) }),
  updateOne: async () => {},
};
const Conversation = { find: () => ({ select: async () => [] }), findByIdAndUpdate: async () => ({ participants: [] }) };
const Message = { create: async (m) => ({ ...m, _id: "m1", populate: async () => ({ ...m, _id: "m1" }) }) };

// ONE shared push.js instance, so the io that initSockets attaches is the one the test publishes through.
const push = await esmock(`${SRC}utils/push.js`, { [`${SRC}models/User.js`]: { default: User } });
const sockets = await esmock(`${SRC}sockets/index.js`, {
  [`${SRC}models/User.js`]: { default: User },
  [`${SRC}models/Conversation.js`]: { default: Conversation },
  [`${SRC}models/Message.js`]: { default: Message },
  [`${SRC}utils/push.js`]: push,
});

const httpServer = http.createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });
sockets.initSockets(io); // also attaches io to push.js
await new Promise((r) => httpServer.listen(0, r));
const url = `http://127.0.0.1:${httpServer.address().port}`;

const client = (uid, background = false) => connect(url, { auth: { token: signToken(uid), ...(background ? { background: true } : {}) }, transports: ["websocket"], forceNew: true });
const once = (s, ev, ms = 1500) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout waiting for " + ev)), ms); s.once(ev, (d) => { clearTimeout(t); res(d); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const offer = { type: "offer", sdp: "v=0" };

test("a background socket is NOT 'online': no presence update, no isOnline write", async () => {
  presence.length = 0;
  const watcher = client("alice"); await once(watcher, "connect");
  const seen = []; watcher.on("presence:update", (p) => seen.push(p));
  presence.length = 0;
  const bg = client("bob", true); await once(bg, "connect"); await wait(150);
  assert.equal(presence.length, 0, "no isOnline update for a background socket");
  assert.equal(seen.length, 0);
  bg.close(); watcher.close(); await wait(50);
});

test("callee has ONLY the background connection and no Firebase → the call rings (no 'unavailable')", async () => {
  const a = client("alice"); await once(a, "connect");
  const bg = client("carol", true); await once(bg, "connect");
  const ring = once(bg, "push");
  a.emit("call:invite", { callId: "b1", calleeId: "carol", conversationId: "conv", kind: "video", offer });
  const got = await ring;
  assert.deepEqual({ type: got.type, callId: got.callId, kind: got.kind, callerName: got.callerName }, { type: "call", callId: "b1", kind: "video", callerName: "Alice" });
  await once(a, "call:ringing");

  // caller cancels → the phone is told to stop ringing
  const stop = once(bg, "push");
  a.emit("call:end", { callId: "b1" });
  const end = await stop;
  assert.deepEqual({ type: end.type, callId: end.callId, reason: end.reason }, { type: "call-end", callId: "b1", reason: "cancelled" });
  a.close(); bg.close(); await wait(50);
});

test("tapping Accept: the app's normal socket connects and gets the invite + buffered ICE; the ring is dismissed", async () => {
  const a = client("alice"); await once(a, "connect");
  const bg = client("carol", true); await once(bg, "connect");
  const pushes = []; bg.on("push", (p) => pushes.push(p));
  a.emit("call:invite", { callId: "b2", calleeId: "carol", conversationId: "conv", kind: "audio", offer });
  await once(a, "call:ringing");
  a.emit("call:ice-candidate", { callId: "b2", candidate: { candidate: "c1" } });
  await wait(100);
  const fg = client("carol");
  const cands = []; fg.on("call:ice-candidate", (d) => cands.push(d.candidate.candidate));
  const inc = new Promise((res) => fg.once("call:incoming", res));
  await once(fg, "connect");
  assert.equal((await inc).callId, "b2");
  await wait(150);
  assert.deepEqual(cands, ["c1"]);
  fg.emit("call:answer", { callId: "b2", answer: { type: "answer", sdp: "v=0" } });
  await once(a, "call:answered"); await wait(100);
  assert.ok(pushes.some((p) => p.type === "call-end" && p.callId === "b2" && p.reason === "answered"));
  a.emit("call:end", { callId: "b2" }); await wait(80);
  a.close(); bg.close(); fg.close(); await wait(50);
});

test("a background socket that reconnects while a call is ringing rings again", async () => {
  const a = client("alice"); await once(a, "connect");
  const first = client("carol", true); await once(first, "connect");
  a.emit("call:invite", { callId: "b3", calleeId: "carol", conversationId: "conv", kind: "audio", offer });
  await once(a, "call:ringing");
  first.close(); await wait(100);
  const again = client("carol", true);
  const ring = once(again, "push");
  await once(again, "connect");
  assert.equal((await ring).callId, "b3");
  a.emit("call:end", { callId: "b3" }); await wait(80);
  a.close(); again.close(); await wait(50);
});

test("new messages are pushed to the background socket of recipients only (not sender / muted / blockers)", async () => {
  const bgBob = client("bob", true), bgCarol = client("carol", true), bgAlice = client("alice", true);
  await Promise.all([once(bgBob, "connect"), once(bgCarol, "connect"), once(bgAlice, "connect")]);
  const got = { bob: [], carol: [], alice: [] };
  bgBob.on("push", (p) => got.bob.push(p)); bgCarol.on("push", (p) => got.carol.push(p)); bgAlice.on("push", (p) => got.alice.push(p));
  const conv = { _id: "conv1", isGroup: false, participants: ["alice", "bob", "carol"], mutedBy: ["carol"] };
  await push.pushNewMessage(conv, { _id: "m9", sender: { _id: "alice", displayName: "Alice" }, text: "hi", attachments: [], encrypted: false, createdAt: new Date() });
  await wait(150);
  assert.equal(got.bob.length, 1);
  assert.equal(got.bob[0].type, "message");
  assert.equal(got.bob[0].preview, "hi");
  assert.equal(got.carol.length, 0, "muted");
  assert.equal(got.alice.length, 0, "sender");
  bgBob.close(); bgCarol.close(); bgAlice.close(); await wait(50);
});

test("nobody connected at all → unavailable (unchanged)", async () => {
  const a = client("alice"); await once(a, "connect");
  a.emit("call:invite", { callId: "b9", calleeId: "bob", conversationId: "conv", kind: "audio", offer });
  await once(a, "call:unavailable");
  a.close(); await wait(50);
});

test.after(() => { io.close(); httpServer.close(); setTimeout(() => process.exit(0), 100); });
