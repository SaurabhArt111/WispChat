import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    displayName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true, select: false },
    avatar: { type: String, default: "" },
    avatarColor: { type: String, default: "#6EE7B7" },
    about: { type: String, default: "Available", maxlength: 140 },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    blocked: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

userSchema.index({ username: "text", displayName: "text", email: "text" });

userSchema.methods.toSafeJSON = function () {
  return {
    _id: this._id,
    username: this.username,
    displayName: this.displayName,
    email: this.email,
    avatar: this.avatar,
    avatarColor: this.avatarColor,
    about: this.about,
    isOnline: this.isOnline,
    lastSeen: this.lastSeen,
  };
};

export default mongoose.model("User", userSchema);
