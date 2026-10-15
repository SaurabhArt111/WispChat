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
  } catch {
    // Preview generation is best-effort: inaccessible pages simply use the
    // plain tappable link in the client rather than returning an HTTP error.
    res.json({ preview: null });
  }
});

export default router;
