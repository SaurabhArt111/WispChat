import mongoose from "mongoose";

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
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    text: { type: String, default: "" },
    attachments: [attachmentSchema],

    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    forwardedFrom: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

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
