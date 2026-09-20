import mongoose from "mongoose";

// A single "Status" post is one slide (image/video/text). A user can have
// several active ones at once, shown as a sequence in the viewer — the same
// shape WhatsApp/Instagram use. Documents expire on their own via the TTL
// index below, so there's no cron job needed to clean these up.
const statusSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["image", "video", "text"], required: true },

    // image/video
    url: { type: String, default: "" },
    mimeType: { type: String, default: "" },

    // text status
    text: { type: String, default: "", maxlength: 700 },
    bgColor: { type: String, default: "" },

    caption: { type: String, default: "", maxlength: 300 },

    viewers: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        at: { type: Date, default: Date.now },
      },
    ],

    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true }
);

statusSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
statusSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("Status", statusSchema);
