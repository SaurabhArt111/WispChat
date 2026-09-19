import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  searchUsers,
  updateProfile,
  getContacts,
  sendFriendRequest,
  listFriendRequests,
  respondFriendRequest,
  toggleBlock,
} from "../controllers/userController.js";

const router = Router();
router.use(requireAuth);

router.get("/search", searchUsers);
router.patch("/profile", updateProfile);
router.get("/contacts", getContacts);
router.post("/friend-requests", sendFriendRequest);
router.get("/friend-requests", listFriendRequests);
router.post("/friend-requests/:requestId/respond", respondFriendRequest);
router.post("/block/:userId", toggleBlock);

export default router;
