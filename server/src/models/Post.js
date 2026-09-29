import mongoose from "mongoose";

// A single Explorer post — one photo or video plus an optional caption,
// Instagram-style. Each user is capped at MAX_POSTS_PER_USER (enforced in
// the controller, see postController.createPost) rather than here, so the
// limit stays a single tunable constant instead of duplicated in a schema
// validator too.
const postSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["image", "video"], required: true },
    url: { type: String, required: true },
    mimeType: { type: String, default: "" },
    caption: { type: String, default: "", maxlength: 500 },
    edited: { type: Boolean, default: false },

    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    comments: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        text: { type: String, required: true, maxlength: 500 },
        edited: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

postSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("Post", postSchema);
