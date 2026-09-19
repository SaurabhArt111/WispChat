import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  listConversations,
  openDirectConversation,
  createGroup,
  updateGroup,
  updateMembers,
  toggleConvoFlag,
  clearConversation,
  leaveGroup,
} from "../controllers/conversationController.js";

const router = Router();
router.use(requireAuth);

router.get("/", listConversations);
router.post("/direct", openDirectConversation);
router.post("/group", createGroup);
router.patch("/group/:id", updateGroup);
router.patch("/group/:id/members", updateMembers);
router.post("/:id/flag", toggleConvoFlag);
router.post("/:id/clear", clearConversation);
router.post("/group/:id/leave", leaveGroup);

export default router;
