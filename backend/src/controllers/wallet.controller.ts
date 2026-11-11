import { Response } from "express";
import { z } from "zod";
import { prisma } from "@/config/prisma";
import { AuthRequest } from "@/middleware/auth";
import { startWalletTopUp } from "@/payments/service";
import { PaymentProviderError } from "@/payments/types";
import {
  adminAdjustWallet,
  getWallet,
  InsufficientWalletBalanceError,
  listAllWallets,
} from "@/wallet/service";

const topUpSchema = z.object({
  amount: z.coerce.number().positive(),
});

const adjustSchema = z.object({
  amount: z.coerce.number().positive(),
  type: z.enum(["ADMIN_CREDIT", "ADMIN_DEBIT"]),
  reason: z.string().min(1).optional(),
});

export async function getMyWallet(req: AuthRequest, res: Response) {
  const wallet = await getWallet(req.user!.id);
  res.json(wallet);
}

export async function startTopUp(req: AuthRequest, res: Response) {
  const parsed = topUpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }

  try {
    const payment = await startWalletTopUp(req.user!.id, parsed.data.amount);
    res.status(201).json({ providerOrderId: payment.providerOrderId, sessionId: payment.sessionId });
  } catch (err) {
    if (err instanceof PaymentProviderError) {
      return res.status(502).json({ message: err.message });
    }
    throw err;
  }
}

export async function listAdminWallets(_req: AuthRequest, res: Response) {
  const wallets = await listAllWallets();
  res.json(wallets);
}

export async function getAdminWallet(req: AuthRequest, res: Response) {
  const userId = req.params.userId as string;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  const wallet = await getWallet(userId);
  res.json(wallet);
}

export async function adjustAdminWallet(req: AuthRequest, res: Response) {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }

  const userId = req.params.userId as string;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  try {
    const transaction = await adminAdjustWallet(
      userId,
      parsed.data.amount,
      parsed.data.type,
      parsed.data.reason,
      req.user!.id,
    );
    res.status(201).json(transaction);
  } catch (err) {
    if (err instanceof InsufficientWalletBalanceError) {
      return res.status(409).json({ message: err.message });
    }
    throw err;
  }
}
