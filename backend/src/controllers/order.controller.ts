import { Response } from "express";
import { z } from "zod";
import { prisma } from "@/config/prisma";
import { AuthRequest } from "@/middleware/auth";
import { startPayment } from "@/payments/service";
import { debitWalletForOrder, InsufficientWalletBalanceError } from "@/wallet/service";

const ORDER_STATUSES = ["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"] as const;
const RESTOCK_STATUSES = new Set(["CANCELLED", "REFUNDED"]);

const updateOrderSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  courier: z.string().min(1).nullable().optional(),
  trackingNumber: z.string().min(1).nullable().optional(),
  trackingUrl: z.string().min(1).nullable().optional(),
});

const createOrderSchema = z.object({
  paymentMethod: z.enum(["CASHFREE", "WALLET"]).default("CASHFREE"),
});

export async function createOrder(req: AuthRequest, res: Response) {
  const { shippingAddress } = req.body;
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }
  const { paymentMethod } = parsed.data;
  const userId = req.user!.id;

  const cartItems = await prisma.cartItem.findMany({
    where: { userId },
    include: { variant: { include: { product: true } } },
  });

  if (cartItems.length === 0) {
    return res.status(400).json({ message: "Cart is empty" });
  }

  try {
    const order = await prisma.$transaction(async (tx) => {
      let totalAmount = 0;

      for (const item of cartItems) {
        if (item.variant.stock < item.quantity) {
          throw new Error(`Insufficient stock for SKU ${item.variant.sku}`);
        }
        const unitPrice = Number(item.variant.product.price) + Number(item.variant.priceDelta);
        totalAmount += unitPrice * item.quantity;
      }

      const newOrder = await tx.order.create({
        data: {
          userId,
          totalAmount,
          shippingAddress,
          ...(paymentMethod === "WALLET" ? { status: "PAID" } : {}),
          items: {
            create: cartItems.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
              price: Number(item.variant.product.price) + Number(item.variant.priceDelta),
            })),
          },
        },
        include: { items: true },
      });

      if (paymentMethod === "WALLET") {
        // Debited before stock decrement so an insufficient balance rolls
        // back the whole transaction (order + nothing-decremented-yet),
        // exactly like the stock check above does.
        await debitWalletForOrder(tx, userId, newOrder.id, totalAmount);
      }

      for (const item of cartItems) {
        await tx.variant.update({
          where: { id: item.variantId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      await tx.cartItem.deleteMany({ where: { userId } });

      return newOrder;
    });

    if (paymentMethod === "WALLET") {
      // Already paid — nothing to start with a gateway.
      return res.status(201).json({ ...order, payment: null });
    }

    // Stock is already committed at this point — a failure here just means
    // the customer retries payment via POST /orders/:id/pay; it never
    // re-creates the order or touches stock again.
    try {
      const payment = await startPayment(order.id, userId);
      res.status(201).json({
        ...order,
        payment: { providerOrderId: payment.providerOrderId, sessionId: payment.sessionId },
      });
    } catch (err) {
      res.status(201).json({
        ...order,
        payment: null,
        paymentError: (err as Error).message,
      });
    }
  } catch (err) {
    if (err instanceof InsufficientWalletBalanceError) {
      return res.status(409).json({ message: err.message });
    }
    res.status(409).json({ message: (err as Error).message });
  }
}

export async function listOrders(req: AuthRequest, res: Response) {
  const orders = await prisma.order.findMany({
    where: { userId: req.user!.id },
    include: { items: { include: { variant: { include: { product: true } } } } },
    orderBy: { createdAt: "desc" },
  });

  res.json(orders);
}

export async function getOrder(req: AuthRequest, res: Response) {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id as string, userId: req.user!.id },
    include: { items: { include: { variant: { include: { product: true } } } } },
  });

  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }

  res.json(order);
}

// Admin: every order regardless of owner, with the customer's identity attached.
export async function listAdminOrders(req: AuthRequest, res: Response) {
  const orders = await prisma.order.findMany({
    include: {
      user: { select: { id: true, name: true, email: true } },
      items: { include: { variant: { include: { product: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(orders);
}

export async function getAdminOrder(req: AuthRequest, res: Response) {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id as string },
    include: {
      user: { select: { id: true, name: true, email: true } },
      items: { include: { variant: { include: { product: true } } } },
      payments: { include: { refunds: true }, orderBy: { createdAt: "desc" } },
      walletTransactions: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }

  res.json(order);
}

export async function updateAdminOrder(req: AuthRequest, res: Response) {
  const parsed = updateOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }

  const orderId = req.params.id as string;
  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!existing) {
    return res.status(404).json({ message: "Order not found" });
  }

  const { status, ...rest } = parsed.data;
  const shouldRestock =
    status && RESTOCK_STATUSES.has(status) && !RESTOCK_STATUSES.has(existing.status);

  const order = await prisma.$transaction(async (tx) => {
    if (shouldRestock) {
      for (const item of existing.items) {
        await tx.variant.update({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
        });
      }
    }

    return tx.order.update({
      where: { id: orderId },
      data: { ...rest, ...(status ? { status } : {}) },
      include: {
        user: { select: { id: true, name: true, email: true } },
        items: { include: { variant: { include: { product: true } } } },
      },
    });
  });

  res.json(order);
}
