import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import esmock from "esmock";

const SRC = new URL("../src/", import.meta.url).pathname;
import { Server } from "socket.io";
import { io as connect } from "socket.io-client";

process.env.JWT_SECRET = "test-secret";
const { signToken } = await import(`${SRC}utils/jwt.js`);

// ---- in-memory fakes -------------------------------------------------------
const users = {
  alice: { _id: "alice", displayName: "Alice", avatar: "", avatarColor: "#fff", pushTokens: [] },
  bob: { _id: "bob", displayName: "Bob", avatar: "", avatarColor: "#fff", pushTokens: [{ token: "tok-bob" }] },
  carol: { _id: "carol", displayName: "Carol", avatar: "", avatarColor: "#fff", pushTokens: [] },
};
const pushes = [];
const messages = [];
let pushOn = true;

const User = {
  findById: (id) => { const u = users[String(id)]; const p = Promise.resolve(u); p.select = () => Promise.resolve(u); return p; },
  findByIdAndUpdate: async () => {},
};
const Conversation = {
  find: () => ({ select: async () => [] }),
  findByIdAndUpdate: async () => ({ participants: [] }),
};
const Message = { create: async (m) => { messages.push(m); return { ...m, _id: "m" + messages.length, populate: async () => ({ ...m, _id: "m" + messages.length }) }; } };
const push = {
  pushEnabled: async () => pushOn,
  pushIncomingCall: async (to, p) => { pushes.push({ type: "call", to, ...p }); return 1; },
  pushCallEnded: async (to, callId, reason) => { pushes.push({ type: "call-end", to, callId, reason }); return 1; },
};

const sockets = await esmock(`${SRC}sockets/index.js`, {
  [`${SRC}models/User.js`]: { default: User },
  [`${SRC}models/Conversation.js`]: { default: Conversation },
  [`${SRC}models/Message.js`]: { default: Message },
  [`${SRC}utils/push.js`]: push,
});

const httpServer = http.createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });
sockets.initSockets(io);
await new Promise((r) => httpServer.listen(0, r));
const url = `http://127.0.0.1:${httpServer.address().port}`;

const client = (uid) => connect(url, { auth: { token: signToken(uid) }, transports: ["websocket"], forceNew: true });
const once = (s, ev, ms = 1500) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout waiting for " + ev)), ms); s.once(ev, (d) => { clearTimeout(t); res(d); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const offer = { type: "offer", sdp: "v=0" };

test("callee with NO app/push and offline → unavailable (unchanged behaviour)", async () => {
  const a = client("alice"); await once(a, "connect");
  a.emit("call:invite", { callId: "c0", calleeId: "carol", conversationId: "conv", kind: "audio", offer });
  await once(a, "call:unavailable");
  assert.equal(pushes.length, 0);
  a.close();
});

test("callee OFFLINE with the app installed → push sent, call stays ringing, re-delivered with buffered ICE when the app starts", async () => {
  pushes.length = 0;
  const a = client("alice"); await once(a, "connect");
  a.emit("call:invite", { callId: "c1", calleeId: "bob", conversationId: "conv", kind: "video", offer, device: { type: "mobile" } });
  await once(a, "call:ringing");
  assert.equal(pushes.length, 1);
  assert.deepEqual({ type: pushes[0].type, to: pushes[0].to, callId: pushes[0].callId, kind: pushes[0].kind }, { type: "call", to: "bob", callId: "c1", kind: "video" });
  assert.equal(pushes[0].from.displayName, "Alice");

  // caller's ICE candidates trickle in while Bob's app is still launching
  a.emit("call:ice-candidate", { callId: "c1", candidate: { candidate: "cand-1" } });
  a.emit("call:ice-candidate", { callId: "c1", candidate: { candidate: "cand-2" } });
  await wait(100);

  // Bob taps Accept → app starts → socket connects
  const b = client("bob");
  const incoming = new Promise((res) => b.once("call:incoming", res));
  const cands = [];
  b.on("call:ice-candidate", (d) => cands.push(d.candidate.candidate));
  await once(b, "connect");
  const inc = await incoming;
  assert.equal(inc.callId, "c1");
  assert.equal(inc.kind, "video");
  assert.deepEqual(inc.offer, offer);
  assert.equal(inc.from.displayName, "Alice");
  await wait(150);
  assert.deepEqual(cands, ["cand-1", "cand-2"], "buffered candidates are flushed in order");

  // Bob answers → Alice gets the answer; the notification is dismissed via push
  const answered = once(a, "call:answered");
  b.emit("call:answer", { callId: "c1", answer: { type: "answer", sdp: "v=0" }, device: { type: "mobile" } });
  await answered;
  assert.ok(pushes.some((p) => p.type === "call-end" && p.callId === "c1" && p.reason === "answered"));

  // later candidates go live (no longer buffered)
  const live = once(b, "call:ice-candidate");
  a.emit("call:ice-candidate", { callId: "c1", candidate: { candidate: "cand-3" } });
  assert.equal((await live).candidate.candidate, "cand-3");
  a.emit("call:end", { callId: "c1" }); await wait(100);
  a.close(); b.close(); await wait(50);
});

test("Decline pressed on the notification (REST path, app closed) → caller told, call cleaned up, push dismissed", async () => {
  pushes.length = 0;
  const a = client("alice"); await once(a, "connect");
  a.emit("call:invite", { callId: "c2", calleeId: "bob", conversationId: "conv", kind: "audio", offer });
  await once(a, "call:ringing");
  const declined = once(a, "call:declined");
  const ok = await sockets.declineCallById(io, "bob", "c2");
  assert.equal(ok, true);
  await declined;
  assert.ok(pushes.some((p) => p.type === "call-end" && p.callId === "c2" && p.reason === "declined"));
  assert.ok(messages.some((m) => m.callInfo?.status === "declined"), "a 'declined' call entry is logged");
  // a stranger can't decline someone else's call
  a.emit("call:invite", { callId: "c3", calleeId: "bob", conversationId: "conv", kind: "audio", offer });
  await once(a, "call:ringing");
  assert.equal(await sockets.declineCallById(io, "carol", "c3"), false);
  assert.equal(await sockets.declineCallById(io, "alice", "c3"), true); // caller cancelling is allowed
  a.close(); await wait(50);
});

test("caller hangs up while the phone is still ringing → push cancels the ring", async () => {
  pushes.length = 0;
  const a = client("alice"); await once(a, "connect");
  a.emit("call:invite", { callId: "c4", calleeId: "bob", conversationId: "conv", kind: "audio", offer });
  await once(a, "call:ringing");
  a.emit("call:end", { callId: "c4" }); await wait(150);
  assert.ok(pushes.some((p) => p.type === "call-end" && p.callId === "c4" && p.reason === "cancelled"));
  a.close(); await wait(50);
});

test("push not configured on the server → offline callee is 'unavailable' like before", async () => {
  pushOn = false; pushes.length = 0;
  const a = client("alice"); await once(a, "connect");
  a.emit("call:invite", { callId: "c5", calleeId: "bob", conversationId: "conv", kind: "audio", offer });
  await once(a, "call:unavailable");
  pushOn = true; a.close(); await wait(50);
});

test("callee already online → rings live over the socket AND is pushed (the phone decides whether to show it)", async () => {
  pushes.length = 0;
  const a = client("alice"), b = client("bob");
  await Promise.all([once(a, "connect"), once(b, "connect")]);
  const live = once(b, "call:incoming");
  a.emit("call:invite", { callId: "c6", calleeId: "bob", conversationId: "conv", kind: "audio", offer });
  assert.equal((await live).callId, "c6");
  assert.ok(pushes.some((p) => p.type === "call" && p.callId === "c6"));
  // a second incoming call while busy → busy
  const c = client("carol"); await once(c, "connect");
  c.emit("call:invite", { callId: "c7", calleeId: "bob", conversationId: "conv2", kind: "audio", offer });
  await once(c, "call:busy");
  a.emit("call:end", { callId: "c6" }); await wait(100);
  a.close(); b.close(); c.close(); await wait(50);
});

test.after(() => { io.close(); httpServer.close(); setTimeout(() => process.exit(0), 100); });
