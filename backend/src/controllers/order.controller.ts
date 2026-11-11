import { Response } from "express";
import { z } from "zod";
import { prisma } from "@/config/prisma";
import { AuthRequest } from "@/middleware/auth";
import { startPayment } from "@/payments/service";
import { debitWalletForOrder, getOrCreateWallet, InsufficientWalletBalanceError } from "@/wallet/service";

const ORDER_STATUSES = ["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"] as const;
const RESTOCK_STATUSES = new Set(["CANCELLED", "REFUNDED"]);

const updateOrderSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  courier: z.string().min(1).nullable().optional(),
  trackingNumber: z.string().min(1).nullable().optional(),
  trackingUrl: z.string().min(1).nullable().optional(),
});

const createOrderSchema = z.object({
  // When true, the order is funded from the wallet first (up to whatever
  // balance is available) and only the remainder — if any — goes to the
  // gateway. A balance that covers the whole order skips the gateway leg
  // entirely; one that covers none of it behaves exactly like a plain
  // gateway checkout.
  useWalletBalance: z.boolean().default(false),
});

export async function createOrder(req: AuthRequest, res: Response) {
  const { shippingAddress } = req.body;
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }
  const { useWalletBalance } = parsed.data;
  const userId = req.user!.id;

  const cartItems = await prisma.cartItem.findMany({
    where: { userId },
    include: { variant: { include: { product: true } } },
  });

  if (cartItems.length === 0) {
    return res.status(400).json({ message: "Cart is empty" });
  }

  try {
    const { order, walletAmount, remainder } = await prisma.$transaction(async (tx) => {
      let totalAmount = 0;

      for (const item of cartItems) {
        if (item.variant.stock < item.quantity) {
          throw new Error(`Insufficient stock for SKU ${item.variant.sku}`);
        }
        const unitPrice = Number(item.variant.product.price) + Number(item.variant.priceDelta);
        totalAmount += unitPrice * item.quantity;
      }

      let walletAmount = 0;
      if (useWalletBalance) {
        const wallet = await getOrCreateWallet(tx, userId);
        walletAmount = Math.min(Number(wallet.balance), totalAmount);
      }
      const remainder = totalAmount - walletAmount;

      const newOrder = await tx.order.create({
        data: {
          userId,
          totalAmount,
          shippingAddress,
          ...(remainder <= 0 ? { status: "PAID" } : {}),
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

      if (walletAmount > 0) {
        // Debited before stock decrement so an insufficient balance rolls
        // back the whole transaction (order + nothing-decremented-yet),
        // exactly like the stock check above does.
        await debitWalletForOrder(tx, userId, newOrder.id, walletAmount);
      }

      for (const item of cartItems) {
        await tx.variant.update({
          where: { id: item.variantId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      await tx.cartItem.deleteMany({ where: { userId } });

      return { order: newOrder, walletAmount, remainder };
    });

    if (remainder <= 0) {
      // Wallet balance covered the whole order — nothing to start with a gateway.
      return res.status(201).json({ ...order, payment: null, walletAmountUsed: walletAmount });
    }

    // Stock is already committed at this point — a failure here just means
    // the customer retries payment via POST /orders/:id/pay; it never
    // re-creates the order or touches stock again. startPayment nets out
    // walletAmount on its own (via the wallet debit just recorded above), so
    // it already asks the gateway for exactly `remainder`, not the full total.
    try {
      const payment = await startPayment(order.id, userId);
      res.status(201).json({
        ...order,
        walletAmountUsed: walletAmount,
        payment: { providerOrderId: payment.providerOrderId, sessionId: payment.sessionId },
      });
    } catch (err) {
      res.status(201).json({
        ...order,
        walletAmountUsed: walletAmount,
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
