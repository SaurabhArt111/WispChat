import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    isGroup: { type: Boolean, default: false },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],

    // Group-only fields
    name: { type: String, trim: true },
    description: { type: String, trim: true, maxlength: 200 },
    avatar: { type: String, default: "" },
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // When true, only admins can post messages in this group — everyone
    // else can still read, react, and see media (classic WhatsApp
    // "announcement group" behaviour).
    onlyAdminsCanMessage: { type: Boolean, default: false },

    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    lastMessageAt: { type: Date, default: Date.now },

    // Per-user state
    mutedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    pinnedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    archivedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // "Delete chat" — removes the conversation from just this user's own
    // list (and clears their message history the same way clearedAt does)
    // without touching it for the other participant(s). It reappears for
    // them automatically the next time a new message lands (see
    // sendMessage), same as WhatsApp/Arattai.
    deletedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // Free-form per-user folder tag ("Work", "Family", …) set via the long
    // press "Add to folder" action — one entry per user, replaced wholesale
    // whenever they retag or clear it.
    folders: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        folder: { type: String, trim: true, maxlength: 40 },
      },
    ],
    clearedAt: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        at: { type: Date },
      },
    ],
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1, isGroup: 1 });
conversationSchema.index({ lastMessageAt: -1 });

export default mongoose.model("Conversation", conversationSchema);
