import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import {
  createPost,
  getUserPosts,
  getExploreFeed,
  likePost,
  commentOnPost,
  deleteComment,
  deletePost,
} from "../controllers/postController.js";

const router = Router();
router.use(requireAuth);

router.get("/feed", getExploreFeed);
router.get("/user/:userId", getUserPosts);
router.post("/", upload.single("file"), createPost);
router.post("/:id/like", likePost);
router.post("/:id/comment", commentOnPost);
router.delete("/:id/comment/:commentId", deleteComment);
router.delete("/:id", deletePost);

export default router;
