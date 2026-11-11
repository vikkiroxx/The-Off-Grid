import { Router } from "express";
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProductSizes,
  listProducts,
  updateProduct,
} from "@/controllers/product.controller";
import { requireAdmin, requireAuth } from "@/middleware/auth";

const router = Router();

router.get("/", listProducts);
router.get("/sizes", listProductSizes);
router.get("/:slug", getProduct);
router.post("/", requireAuth, requireAdmin, createProduct);
router.patch("/:id", requireAuth, requireAdmin, updateProduct);
router.delete("/:id", requireAuth, requireAdmin, deleteProduct);

export default router;
