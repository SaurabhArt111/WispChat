import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getLinkPreview } from "../utils/linkPreview.js";

const router = Router();
router.use(requireAuth);

// GET /api/link-preview?url=https://example.com/page
router.get("/", async (req, res) => {
  const url = String(req.query.url || "");
  if (!url || url.length > 2048) return res.status(400).json({ message: "A valid url is required" });
  try {
    const preview = await getLinkPreview(url);
    res.json({ preview });
  } catch (err) {
    // Not an error worth surfacing loudly — plenty of links simply have no
    // preview. The client falls back to a plain tappable link.
    res.status(422).json({ message: "No preview available" });
  }
});

export default router;
