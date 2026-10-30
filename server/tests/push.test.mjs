import test from "node:test";
import assert from "node:assert/strict";
import esmock from "esmock";

const SRC = new URL("../src/", import.meta.url).pathname;

const sent = [];
const pulled = [];
const tokensByUser = { bob: ["tb1", "tb-dead"], carol: ["tc1"], dave: ["td1"], erin: ["te1"] };
const blockers = ["dave"]; // dave blocked the sender

const User = {
  findById: (id) => ({ select: async () => ({ pushTokens: (tokensByUser[id] || []).map((token) => ({ token })) }) }),
  find: () => ({ select: () => ({ lean: async () => blockers.map((_id) => ({ _id })) }) }),
  updateOne: async (f, u) => { pulled.push({ f, u }); },
};
const push = await esmock(`${SRC}utils/push.js`, { [`${SRC}models/User.js`]: { default: User } });
push._setMessaging({
  sendEachForMulticast: async (m) => {
    sent.push(m);
    return {
      successCount: m.tokens.filter((t) => t !== "tb-dead").length,
      responses: m.tokens.map((t) => (t === "tb-dead" ? { success: false, error: { code: "messaging/registration-token-not-registered" } } : { success: true })),
    };
  },
});

const conv = { _id: "conv1", isGroup: false, participants: ["alice", "bob", "carol", "dave", "erin"], mutedBy: ["carol"] };
const msg = (over = {}) => ({ _id: "m1", sender: { _id: "alice", displayName: "Alice" }, text: "hello there", attachments: [], encrypted: false, createdAt: new Date(1700000000000), ...over });
const recipients = () => sent.flatMap((m) => m.tokens);
const reset = () => { sent.length = 0; pulled.length = 0; };

test("goes to everyone except the sender, people who muted the chat, and people who blocked the sender", async () => {
  reset();
  await push.pushNewMessage(conv, msg());
  assert.deepEqual(recipients().sort(), ["tb-dead", "tb1", "te1"]);
});

test("payload is data-only, every value a string, high priority, carries what the phone needs", async () => {
  reset();
  await push.pushNewMessage(conv, msg());
  const m = sent[0];
  assert.equal(m.notification, undefined, "no 'notification' block — the app builds it, so it works when closed");
  assert.equal(m.android.priority, "high");
  assert.ok(Object.values(m.data).every((v) => typeof v === "string"));
  assert.deepEqual(
    { type: m.data.type, conversationId: m.data.conversationId, senderName: m.data.senderName, preview: m.data.preview, isGroup: m.data.isGroup },
    { type: "message", conversationId: "conv1", senderName: "Alice", preview: "hello there", isGroup: "false" }
  );
});

test("E2EE text never leaves the server in a push; attachments get a label", async () => {
  reset();
  await push.pushNewMessage(conv, msg({ encrypted: true, text: "bm90LXJlYWRhYmxl" }));
  assert.equal(sent[0].data.preview, "New message");
  reset();
  await push.pushNewMessage(conv, msg({ attachments: [{ kind: "image" }, { kind: "image" }], text: "" }));
  assert.equal(sent[0].data.preview, "📷 Photo (+1)");
  reset();
  await push.pushNewMessage(conv, msg({ attachments: [{ kind: "audio" }], encrypted: true }));
  assert.equal(sent[0].data.preview, "🎤 Voice message");
  reset();
  await push.pushNewMessage(conv, msg({ text: "x".repeat(300) }));
  assert.ok(sent[0].data.preview.length <= 140);
});

test("group chats include the group name and flag", async () => {
  reset();
  await push.pushNewMessage({ ...conv, isGroup: true, name: "Team" }, msg());
  assert.equal(sent[0].data.groupName, "Team");
  assert.equal(sent[0].data.isGroup, "true");
});

test("dead tokens reported by Firebase are removed from the user", async () => {
  reset();
  await push.sendToUser("bob", { type: "x" });
  assert.equal(pulled.length, 1);
  assert.deepEqual(pulled[0].u, { $pull: { pushTokens: { token: { $in: ["tb-dead"] } } } });
});

test("call messages (call summaries) aren't pushed as chat notifications", async () => {
  reset();
  await push.pushNewMessage(conv, msg({ callInfo: { kind: "audio", status: "missed" } }));
  assert.equal(sent.length, 0);
});

test("incoming-call push: short TTL, caller details, plus call-end", async () => {
  reset();
  await push.pushIncomingCall("erin", { callId: "c9", conversationId: "conv1", kind: "video", from: { _id: "alice", displayName: "Alice" } });
  assert.equal(sent[0].android.ttl, 45000);
  assert.deepEqual({ type: sent[0].data.type, callId: sent[0].data.callId, kind: sent[0].data.kind, callerName: sent[0].data.callerName }, { type: "call", callId: "c9", kind: "video", callerName: "Alice" });
  await push.pushCallEnded("erin", "c9", "answered");
  assert.equal(sent[1].data.type, "call-end");
});

test("no tokens → nothing sent", async () => {
  reset();
  assert.equal(await push.sendToUser("nobody", { type: "x" }), 0);
  assert.equal(sent.length, 0);
});
