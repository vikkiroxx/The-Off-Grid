import { Router } from "express";
import { getMyWallet, startTopUp } from "@/controllers/wallet.controller";
import { requireAuth } from "@/middleware/auth";

const router = Router();

router.use(requireAuth);
router.get("/", getMyWallet);
router.post("/topup", startTopUp);

export default router;
