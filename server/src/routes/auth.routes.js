import { Router } from "express";
import { register, login, me, logout, setupE2EE } from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", requireAuth, me);
router.post("/logout", requireAuth, logout);
router.post("/e2ee-setup", requireAuth, setupE2EE);

export default router;
