import { Prisma, WalletTransaction, WalletTransactionType } from "@prisma/client";
import { prisma } from "@/config/prisma";

type Tx = Prisma.TransactionClient;

export class InsufficientWalletBalanceError extends Error {}

// Defensive fallback — new signups get a Wallet created at signup time (see
// auth.controller.ts), so this upsert only ever does real work for users
// that predate the wallet migration (dev DB, the seeded test user).
export async function getOrCreateWallet(tx: Tx, userId: string) {
  return tx.wallet.upsert({
    where: { userId },
    create: { userId, balance: 0 },
    update: {},
  });
}

// The one place that ever mutates Wallet.balance. amount is signed (credits
// positive, debits negative). The balance >= |amount| guard on debits lives
// on the same atomic UPDATE as the increment, so Postgres's row lock makes
// the check-then-write atomic under concurrent debits without needing
// SERIALIZABLE isolation — mirrors the optimistic updateMany guard already
// used for Payment status transitions in payments/service.ts.
async function applyLedgerEntry(
  tx: Tx,
  args: {
    walletId: string;
    type: WalletTransactionType;
    amount: number;
    reason?: string;
    orderId?: string;
    adminId?: string;
  },
): Promise<WalletTransaction> {
  const updated = await tx.wallet.updateMany({
    where: {
      id: args.walletId,
      ...(args.amount < 0 ? { balance: { gte: -args.amount } } : {}),
    },
    data: { balance: { increment: args.amount } },
  });

  if (updated.count === 0) {
    throw new InsufficientWalletBalanceError("Insufficient wallet balance");
  }

  const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: args.walletId } });

  return tx.walletTransaction.create({
    data: {
      walletId: args.walletId,
      type: args.type,
      status: "COMPLETED",
      amount: args.amount,
      balanceAfter: wallet.balance,
      reason: args.reason,
      orderId: args.orderId,
      adminId: args.adminId,
    },
  });
}

export async function debitWalletForOrder(
  tx: Tx,
  userId: string,
  orderId: string,
  amount: number,
): Promise<WalletTransaction> {
  const wallet = await getOrCreateWallet(tx, userId);
  return applyLedgerEntry(tx, {
    walletId: wallet.id,
    type: "ORDER_PAYMENT",
    amount: -amount,
    orderId,
  });
}

export async function creditWalletForRefund(
  tx: Tx,
  userId: string,
  orderId: string,
  amount: number,
  reason: string | undefined,
): Promise<WalletTransaction> {
  const wallet = await getOrCreateWallet(tx, userId);
  return applyLedgerEntry(tx, { walletId: wallet.id, type: "REFUND", amount, orderId, reason });
}

export async function adminAdjustWallet(
  targetUserId: string,
  amount: number,
  type: "ADMIN_CREDIT" | "ADMIN_DEBIT",
  reason: string | undefined,
  adminUserId: string,
): Promise<WalletTransaction> {
  return prisma.$transaction(async (tx) => {
    const wallet = await getOrCreateWallet(tx, targetUserId);
    const signed = type === "ADMIN_CREDIT" ? amount : -amount;
    return applyLedgerEntry(tx, {
      walletId: wallet.id,
      type,
      amount: signed,
      reason,
      adminId: adminUserId,
    });
  });
}

// Guarded completion of a PENDING top-up: only the caller that successfully
// flips WalletTransaction.status (count 1) actually credits the wallet, so a
// webhook/reconcile race applies the credit at most once. Kept separate from
// applyLedgerEntry because the WalletTransaction row already exists (created
// PENDING in payments/service.ts#startWalletTopUp) rather than being created
// fresh here.
export async function completeTopUp(tx: Tx, walletTransactionId: string): Promise<boolean> {
  const topUp = await tx.walletTransaction.findUniqueOrThrow({ where: { id: walletTransactionId } });
  const guarded = await tx.walletTransaction.updateMany({
    where: { id: walletTransactionId, status: "PENDING" },
    data: { status: "COMPLETED" },
  });
  if (guarded.count === 0) return false;

  const updatedWallet = await tx.wallet.update({
    where: { id: topUp.walletId },
    data: { balance: { increment: topUp.amount } },
  });
  await tx.walletTransaction.update({
    where: { id: walletTransactionId },
    data: { balanceAfter: updatedWallet.balance },
  });
  return true;
}

export async function failTopUp(tx: Tx, walletTransactionId: string, status: "FAILED" | "CANCELLED") {
  await tx.walletTransaction.updateMany({
    where: { id: walletTransactionId, status: "PENDING" },
    data: { status },
  });
}

export async function getWallet(userId: string) {
  const wallet = await getOrCreateWallet(prisma, userId);
  const transactions = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: "desc" },
  });
  return { ...wallet, transactions };
}

export async function listAllWallets() {
  return prisma.wallet.findMany({
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { updatedAt: "desc" },
  });
}
