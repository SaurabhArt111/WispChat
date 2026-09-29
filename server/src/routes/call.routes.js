import { Router } from "express";
import crypto from "crypto";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// ICE server list for WebRTC calls. STUN alone connects most home
// networks, but symmetric NATs, mobile carriers and corporate firewalls
// need a TURN relay or the call connects with no audio/video (the classic
// "call rings and connects but nothing shows"). Configure one of:
//
//   1. TURN_URLS + TURN_SECRET      -> coturn with `use-auth-secret`
//      (short-lived credentials are generated per request)
//   2. TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL -> static credentials
//      (Metered, Twilio Network Traversal, Xirsys, self-hosted, ...)
//
// TURN_URLS is comma separated, e.g.
//   turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349
router.get("/ice", (req, res) => {
  const iceServers = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
  ];

  const urls = (process.env.TURN_URLS || "").split(",").map((u) => u.trim()).filter(Boolean);
  if (urls.length) {
    if (process.env.TURN_SECRET) {
      const expiry = Math.floor(Date.now() / 1000) + 6 * 3600;
      const username = `${expiry}:${req.user._id}`;
      const credential = crypto.createHmac("sha1", process.env.TURN_SECRET).update(username).digest("base64");
      iceServers.push({ urls, username, credential });
    } else if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      iceServers.push({ urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
    }
  }

  res.json({ iceServers, hasTurn: iceServers.length > 1 });
});

export default router;
