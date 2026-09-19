import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import {
  getMessages,
  sendMessage,
  uploadMedia,
  editMessage,
  deleteMessage,
  reactToMessage,
  forwardMessage,
  markRead,
  getMediaStats,
} from "../controllers/messageController.js";

const router = Router();
router.use(requireAuth);

router.get("/media/stats", getMediaStats);
router.get("/:conversationId", getMessages);
router.post("/:conversationId", sendMessage);
router.post("/:conversationId/read", markRead);
router.post("/upload/media", upload.array("files", 10), uploadMedia);
router.patch("/msg/:id", editMessage);
router.delete("/msg/:id", deleteMessage);
router.post("/msg/:id/react", reactToMessage);
router.post("/msg/:id/forward", forwardMessage);

export default router;
