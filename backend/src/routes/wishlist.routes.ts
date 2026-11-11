import { Router } from "express";
import { addToWishlist, getWishlist, removeFromWishlist } from "@/controllers/wishlist.controller";
import { requireAuth } from "@/middleware/auth";

const router = Router();

router.use(requireAuth);
router.get("/", getWishlist);
router.post("/", addToWishlist);
router.delete("/:id", removeFromWishlist);

export default router;
