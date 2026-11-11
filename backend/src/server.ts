import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import authRoutes from "@/routes/auth.routes";
import userRoutes from "@/routes/user.routes";
import productRoutes from "@/routes/product.routes";
import categoryRoutes from "@/routes/category.routes";
import cartRoutes from "@/routes/cart.routes";
import wishlistRoutes from "@/routes/wishlist.routes";
import orderRoutes from "@/routes/order.routes";
import uploadRoutes from "@/routes/upload.routes";
import contactRoutes from "@/routes/contact.routes";
import adminRoutes from "@/routes/admin.routes";
import paymentRoutes from "@/routes/payment.routes";
import walletRoutes from "@/routes/wallet.routes";
import { errorHandler, notFound } from "@/middleware/errorHandler";
import { validateEnv } from "@/config/env";

validateEnv();

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(
  express.json({
    // Captures the exact bytes received into req.rawBody, alongside the
    // normal parsed req.body — needed to verify the Cashfree webhook
    // signature, which is computed over the raw payload, not a
    // JSON.parse/stringify round-trip of it.
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  }),
);

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/wallet", walletRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
