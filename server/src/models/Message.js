import mongoose from "mongoose";

const callInfoSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["audio", "video"] },
    status: { type: String, enum: ["completed", "missed", "declined"] },
    durationSec: { type: Number, default: 0 },
  },
  { _id: false }
);

const attachmentSchema = new mongoose.Schema(
  {
    url: String,
    name: String,
    mimeType: String,
    size: Number,
    width: Number,
    height: Number,
    duration: Number,
    kind: { type: String, enum: ["image", "video", "audio", "file"], default: "file" },
    // Set when this file's bytes on disk are AES-GCM ciphertext (encrypted
    // client-side before upload). `iv` is the per-attachment initialization
    // vector; the actual decryption key travels in the message's `keys`
    // envelope below, never on the attachment itself.
    encrypted: { type: Boolean, default: false },
    iv: { type: String, default: null },
    // Original media dimensions/etc are still stored above in plaintext —
    // only the file bytes are opaque to the server, not the metadata.
    asDocument: { type: Boolean, default: false },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    text: { type: String, default: "" },
    attachments: [attachmentSchema],

    // --- End-to-end encryption ---
    // When `encrypted` is true, `text` above holds base64 AES-GCM
    // ciphertext (not the message), `iv` is its initialization vector, and
    // `keys` is the per-recipient envelope: each participant's copy of the
    // random per-message AES key, individually wrapped via an ECDH shared
    // secret between them and the sender. The server only ever stores and
    // relays these opaque blobs — it has no way to read message content.
    encrypted: { type: Boolean, default: false },
    iv: { type: String, default: null },
    keys: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        wrappedKey: String,
        keyIv: String,
        _id: false,
      },
    ],

    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    forwardedFrom: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Present only on the system-style summary message logged when a
    // call started from this conversation ends (see server/src/sockets —
    // calls themselves are signaled entirely over sockets, never stored;
    // this is just the "Voice call · 2m 14s" / "Missed video call" line
    // left behind afterward, the same way WhatsApp leaves a call entry
    // in the chat).
    callInfo: { type: callInfoSchema, default: undefined },

    reactions: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        emoji: String,
      },
    ],

    deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    edited: { type: Boolean, default: false },
    editedAt: Date,

    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    deletedForEveryone: { type: Boolean, default: false },

    clientId: { type: String }, // for optimistic-send de-dupe
  },
  { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index({ sender: 1, clientId: 1 });

export default mongoose.model("Message", messageSchema);
