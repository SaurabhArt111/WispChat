import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { signToken } from "../utils/jwt.js";

const AVATAR_COLORS = ["#6EE7B7", "#F2B880", "#93C5FD", "#F9A8D4", "#C4B5FD", "#FCA5A5", "#7DD3FC"];

function pickColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

export async function register(req, res) {
  try {
    const { username, displayName, email, password, e2ee } = req.body;
    if (!username || !displayName || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const existing = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }],
    });
    if (existing) {
      return res.status(409).json({
        message: existing.email === email.toLowerCase() ? "Email already registered" : "Username already taken",
      });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      username: username.toLowerCase(),
      displayName,
      email: email.toLowerCase(),
      password: hashed,
      avatarColor: pickColor(),
      // The client generates the end-to-end encryption keypair *before*
      // registering and only ever sends us the public key plus the
      // password-wrapped private key blob — we store that bundle against
      // the account (not a device) so any device the person logs into can
      // fetch it and unlock it locally with their password.
      e2ee: e2ee?.publicKeyJwk
        ? {
            publicKeyJwk: e2ee.publicKeyJwk,
            wrappedPrivateKey: e2ee.wrappedPrivateKey,
            wrapIv: e2ee.wrapIv,
            kdfSalt: e2ee.kdfSalt,
            kdfIterations: e2ee.kdfIterations,
          }
        : undefined,
    });

    const token = signToken(user._id);
    res.status(201).json({ token, user: user.toPrivateJSON() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Registration failed" });
  }
}

export async function login(req, res) {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) return res.status(400).json({ message: "Missing credentials" });

    const user = await User.findOne({
      $or: [{ email: identifier.toLowerCase() }, { username: identifier.toLowerCase() }],
    }).select("+password +e2ee.wrappedPrivateKey +e2ee.wrapIv +e2ee.kdfSalt +e2ee.kdfIterations");

    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: "Invalid credentials" });

    user.isOnline = true;
    await user.save();

    const token = signToken(user._id);
    res.json({ token, user: user.toPrivateJSON(), needsE2EESetup: !user.e2ee?.publicKeyJwk });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Login failed" });
  }
}

export async function me(req, res) {
  const user = await User.findById(req.user._id).select(
    "+e2ee.wrappedPrivateKey +e2ee.wrapIv +e2ee.kdfSalt +e2ee.kdfIterations"
  );
  res.json({ user: user.toPrivateJSON(), needsE2EESetup: !user.e2ee?.publicKeyJwk });
}

// First login after this feature shipped (or any account created before
// E2EE existed) has no keypair yet. The client generates one locally,
// wraps the private key with a key derived from the password the person
// is already holding, and hands us only the public key + wrapped bundle.
export async function setupE2EE(req, res) {
  try {
    const { publicKeyJwk, wrappedPrivateKey, wrapIv, kdfSalt, kdfIterations } = req.body;
    if (!publicKeyJwk || !wrappedPrivateKey || !wrapIv || !kdfSalt || !kdfIterations) {
      return res.status(400).json({ message: "Incomplete encryption bundle" });
    }
    const user = await User.findById(req.user._id).select("+e2ee.wrappedPrivateKey");
    if (user.e2ee?.publicKeyJwk) {
      return res.status(409).json({ message: "Encryption keys already set up for this account" });
    }
    user.e2ee = { publicKeyJwk, wrappedPrivateKey, wrapIv, kdfSalt, kdfIterations };
    await user.save();
    res.json({ user: user.toPrivateJSON() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Couldn't set up encryption" });
  }
}

export async function logout(req, res) {
  try {
    req.user.isOnline = false;
    req.user.lastSeen = new Date();
    await req.user.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: "Logout failed" });
  }
}
