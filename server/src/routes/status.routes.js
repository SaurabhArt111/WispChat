import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { getFeed, createStatus, viewStatus, deleteStatus } from "../controllers/statusController.js";

const router = Router();
router.use(requireAuth);

router.get("/", getFeed);
router.post("/", upload.single("file"), createStatus);
router.post("/:id/view", viewStatus);
router.delete("/:id", deleteStatus);

export default router;
