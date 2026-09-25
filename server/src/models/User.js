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

    // --- End-to-end encryption identity ---
    // publicKeyJwk is safe to hand out to anyone (it's how peers encrypt
    // *to* this user) so it stays selected by default. The wrapped private
    // key + its KDF params are only ever needed by the account owner to
    // unlock their own key on a (possibly new) device, so they're kept out
    // of every normal query unless explicitly requested with `.select`.
    e2ee: {
      publicKeyJwk: { type: mongoose.Schema.Types.Mixed, default: null },
      wrappedPrivateKey: { type: String, default: null, select: false },
      wrapIv: { type: String, default: null, select: false },
      kdfSalt: { type: String, default: null, select: false },
      kdfIterations: { type: Number, default: 0, select: false },
    },
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
    e2ee: { publicKeyJwk: this.e2ee?.publicKeyJwk || null },
  };
};

// Only ever handed to the account owner (register/login/me) — includes the
// *wrapped* private key bundle so their client can unlock it locally with
// their password. The private key itself never exists in plaintext on the
// server; this is opaque ciphertext that's useless without the password.
userSchema.methods.toPrivateJSON = function () {
  return {
    ...this.toSafeJSON(),
    e2ee: {
      publicKeyJwk: this.e2ee?.publicKeyJwk || null,
      wrappedPrivateKey: this.e2ee?.wrappedPrivateKey || null,
      wrapIv: this.e2ee?.wrapIv || null,
      kdfSalt: this.e2ee?.kdfSalt || null,
      kdfIterations: this.e2ee?.kdfIterations || 0,
    },
  };
};

export default mongoose.model("User", userSchema);
