import { Router } from "express";
import { register, login, me, logout, setupE2EE, googleLogin } from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/google", googleLogin);
// Public: lets the client know whether to show the Google button.
router.get("/config", (req, res) => res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID?.split(",")[0]?.trim() || null }));
router.get("/me", requireAuth, me);
router.post("/logout", requireAuth, logout);
router.post("/e2ee-setup", requireAuth, setupE2EE);

export default router;
