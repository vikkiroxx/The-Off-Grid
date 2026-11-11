import { randomUUID } from "crypto";
import { Order, Payment } from "@prisma/client";
import { prisma } from "@/config/prisma";
import { getPaymentProvider } from "@/payments/factory";
import {
  NormalizedPaymentStatus,
  PaymentCustomer,
  PaymentProviderError,
  VerifiedWebhookEvent,
  WebhookSignatureError,
} from "@/payments/types";
import { UnhandledWebhookEventError } from "@/payments/providers/cashfree/cashfree.provider";
import {
  completeTopUp,
  creditWalletForRefund,
  failTopUp,
  getOrCreateWallet,
} from "@/wallet/service";

const ACTIVE_STATUSES = ["PENDING", "PROCESSING"] as const;
const TERMINAL_STATUSES = ["SUCCEEDED", "FAILED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"];
const REFUND_OPEN_STATUSES = ["PENDING", "SUCCEEDED"];

function frontendUrl() {
  return process.env.FRONTEND_URL ?? "http://localhost:3000";
}

function backendUrl() {
  return process.env.BACKEND_PUBLIC_URL ?? "http://localhost:5000";
}

function buildReturnUrl() {
  // {order_id} is a literal placeholder Cashfree substitutes before redirecting —
  // not a template to fill in ourselves.
  return `${frontendUrl()}/checkout/result?order_id={order_id}`;
}

function buildWalletTopUpReturnUrl() {
  return `${frontendUrl()}/wallet/result?order_id={order_id}`;
}

function buildNotifyUrl() {
  return `${backendUrl()}/api/payments/webhooks/cashfree`;
}

function extractPhone(order: Order): string | undefined {
  const addr = order.shippingAddress as { phone?: string } | null;
  return addr?.phone;
}

export class OrderNotPayableError extends Error {}
export class PaymentNotFoundError extends Error {}
export class RefundNotAllowedError extends Error {}

// Starts a new payment attempt for an order, or — if one is already in
// flight — asks the provider to refresh it rather than creating a duplicate
// (stock was already decremented once, at order creation; this never touches
// stock again).
export async function startPayment(orderId: string, requestingUserId: string): Promise<Payment> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: requestingUserId },
    include: { payments: { orderBy: { createdAt: "desc" } }, user: true },
  });

  if (!order) throw new PaymentNotFoundError("Order not found");
  if (order.status !== "PENDING") {
    throw new OrderNotPayableError(`Order is ${order.status.toLowerCase()}, not payable`);
  }

  // Nets out any wallet contribution already debited for this order (a split
  // checkout pays part from the wallet up front — see createOrder) so the
  // gateway is only ever asked for what's actually still owed, not the full
  // order total.
  const walletDebit = await prisma.walletTransaction.aggregate({
    where: { orderId: order.id, type: "ORDER_PAYMENT" },
    _sum: { amount: true },
  });
  const gatewayAmount = Number(order.totalAmount) - Math.abs(Number(walletDebit._sum.amount ?? 0));
  if (gatewayAmount <= 0) {
    throw new OrderNotPayableError("Order is already fully paid from the wallet");
  }

  const provider = getPaymentProvider();
  const customer: PaymentCustomer = {
    id: order.user.id,
    name: order.user.name,
    email: order.user.email,
    phone: extractPhone(order) ?? "9999999999",
  };

  const active = order.payments.find((p) =>
    (ACTIVE_STATUSES as readonly string[]).includes(p.status),
  );

  if (active) {
    const result = await provider.createPayment({
      paymentId: active.id,
      providerOrderId: active.providerOrderId,
      idempotencyKey: active.idempotencyKey,
      amount: Number(active.amount),
      currency: active.currency,
      customer,
      returnUrl: buildReturnUrl(),
      notifyUrl: buildNotifyUrl(),
    });
    return prisma.payment.update({
      where: { id: active.id },
      data: { sessionId: result.sessionId, providerRefId: result.providerRefId },
    });
  }

  const paymentId = randomUUID();
  const providerOrderId = `pay_${paymentId}`;
  const idempotencyKey = randomUUID();

  const created = await prisma.payment.create({
    data: {
      id: paymentId,
      orderId: order.id,
      provider: provider.id,
      providerOrderId,
      idempotencyKey,
      amount: gatewayAmount,
      currency: "INR",
      status: "PENDING",
    },
  });

  try {
    const result = await provider.createPayment({
      paymentId,
      providerOrderId,
      idempotencyKey,
      amount: gatewayAmount,
      currency: "INR",
      customer,
      returnUrl: buildReturnUrl(),
      notifyUrl: buildNotifyUrl(),
    });

    return await prisma.payment.update({
      where: { id: created.id },
      data: { sessionId: result.sessionId, providerRefId: result.providerRefId },
    });
  } catch (err) {
    await prisma.payment.update({
      where: { id: created.id },
      data: {
        status: "FAILED",
        failureMessage:
          err instanceof PaymentProviderError ? err.message : "Could not start payment",
      },
    });
    throw err;
  }
}

// Starts a Cashfree-funded wallet top-up. Unlike startPayment, there's no
// Order to scope a "resume active attempt" retry by — each submission is an
// independent attempt. An abandoned PENDING top-up is simply left behind,
// uncredited, matching the already-documented "no automatic expiry" gap for
// order payments.
export async function startWalletTopUp(userId: string, amount: number): Promise<Payment> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const defaultAddress = await prisma.address.findFirst({
    where: { userId },
    orderBy: { isDefault: "desc" },
  });

  const provider = getPaymentProvider();
  const customer: PaymentCustomer = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: defaultAddress?.phone ?? "9999999999",
  };

  const paymentId = randomUUID();
  const providerOrderId = `topup_${paymentId}`;
  const idempotencyKey = randomUUID();

  const { payment, walletTransactionId } = await prisma.$transaction(async (tx) => {
    const wallet = await getOrCreateWallet(tx, userId);
    const walletTransaction = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "TOPUP",
        status: "PENDING",
        amount,
        balanceAfter: wallet.balance,
      },
    });
    const created = await tx.payment.create({
      data: {
        id: paymentId,
        purpose: "WALLET_TOPUP",
        walletTransactionId: walletTransaction.id,
        provider: provider.id,
        providerOrderId,
        idempotencyKey,
        amount,
        currency: "INR",
        status: "PENDING",
      },
    });
    return { payment: created, walletTransactionId: walletTransaction.id };
  });

  try {
    const result = await provider.createPayment({
      paymentId,
      providerOrderId,
      idempotencyKey,
      amount,
      currency: "INR",
      customer,
      returnUrl: buildWalletTopUpReturnUrl(),
      notifyUrl: buildNotifyUrl(),
    });

    return await prisma.payment.update({
      where: { id: payment.id },
      data: { sessionId: result.sessionId, providerRefId: result.providerRefId },
    });
  } catch (err) {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          failureMessage:
            err instanceof PaymentProviderError ? err.message : "Could not start top-up",
        },
      });
      await failTopUp(tx, walletTransactionId, "FAILED");
    });
    throw err;
  }
}

// The single trusted entry point for recording a payment outcome, called
// from both the webhook handler and the customer-facing status-reconcile
// endpoint. Idempotent: safe to call twice with the same (or stale) result,
// and safe under concurrent calls (the update is guarded on the status it
// read, so only one concurrent caller can win the transition).
async function applyVerifiedResult(
  payment: Payment,
  result: {
    status: NormalizedPaymentStatus;
    providerPaymentId: string | null;
    amount: number | null;
    currency: string | null;
    failureMessage?: string | null;
  },
): Promise<{ applied: boolean; payment: Payment }> {
  if (TERMINAL_STATUSES.includes(payment.status)) {
    return { applied: false, payment };
  }

  if (result.amount != null && Math.abs(result.amount - Number(payment.amount)) > 0.01) {
    throw new Error(
      `Refusing to apply payment result: amount mismatch (expected ${payment.amount}, got ${result.amount})`,
    );
  }
  if (result.currency && result.currency !== payment.currency) {
    throw new Error(
      `Refusing to apply payment result: currency mismatch (expected ${payment.currency}, got ${result.currency})`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const updateResult = await tx.payment.updateMany({
      where: { id: payment.id, status: payment.status },
      data: {
        status: result.status,
        providerPaymentId: result.providerPaymentId ?? payment.providerPaymentId,
        failureMessage: result.failureMessage ?? undefined,
      },
    });

    if (updateResult.count === 0) {
      // A concurrent call already moved this payment on — idempotent no-op.
      const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      return { applied: false, payment: current };
    }

    if (result.status === "SUCCEEDED") {
      if (payment.purpose === "ORDER_PAYMENT") {
        // orderId is guaranteed non-null when purpose is ORDER_PAYMENT.
        await tx.order.updateMany({
          where: { id: payment.orderId!, status: "PENDING" },
          data: { status: "PAID" },
        });
        // Any sibling attempt (e.g. an abandoned first try) is now moot.
        // Scoped to purpose === ORDER_PAYMENT deliberately: payment.orderId is
        // null for WALLET_TOPUP payments, and an unscoped query here would
        // match (and cancel) every other user's pending top-up at once.
        await tx.payment.updateMany({
          where: {
            orderId: payment.orderId,
            id: { not: payment.id },
            status: { in: ["PENDING", "PROCESSING"] },
          },
          data: { status: "CANCELLED" },
        });
      } else if (payment.walletTransactionId) {
        await completeTopUp(tx, payment.walletTransactionId);
      }
    } else if (
      payment.purpose === "WALLET_TOPUP" &&
      payment.walletTransactionId &&
      (result.status === "FAILED" || result.status === "CANCELLED")
    ) {
      await failTopUp(tx, payment.walletTransactionId, result.status);
    }

    const updated = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return { applied: true, payment: updated };
  });
}

export async function reconcilePaymentStatus(
  providerOrderId: string,
  requestingUserId: string,
): Promise<Payment> {
  const provider = getPaymentProvider();
  const payment = await prisma.payment.findUnique({
    where: { provider_providerOrderId: { provider: provider.id, providerOrderId } },
    include: { order: true, walletTransaction: { include: { wallet: true } } },
  });

  const ownerId = payment?.order?.userId ?? payment?.walletTransaction?.wallet.userId;
  if (!payment || ownerId !== requestingUserId) {
    throw new PaymentNotFoundError("Payment not found");
  }

  if (TERMINAL_STATUSES.includes(payment.status)) {
    return payment;
  }

  const status = await provider.getPaymentStatus(providerOrderId);
  const { payment: result } = await applyVerifiedResult(payment, status);
  return result;
}

export async function handleWebhook(args: {
  rawBody: string;
  signature: string;
  timestamp: string;
  bodyHash: string;
}): Promise<{ duplicate: boolean; handled: boolean }> {
  const provider = getPaymentProvider();

  const existingEvent = await prisma.paymentWebhookEvent.findUnique({
    where: { provider_bodyHash: { provider: provider.id, bodyHash: args.bodyHash } },
  });
  if (existingEvent) {
    return { duplicate: true, handled: false };
  }

  const recordEvent = (paymentId: string | null, type: string) =>
    prisma.paymentWebhookEvent.create({
      data: { provider: provider.id, paymentId, type, bodyHash: args.bodyHash },
    });

  let event: VerifiedWebhookEvent;
  try {
    event = await provider.verifyWebhook(args);
  } catch (err) {
    if (err instanceof UnhandledWebhookEventError) {
      // Not a webhook type we act on (e.g. a refund/dispute event) — safe to
      // record immediately, since there's nothing to ever retry here.
      await recordEvent(null, err.type);
      return { duplicate: false, handled: false };
    }
    throw err;
  }

  const payment = await prisma.payment.findUnique({
    where: { provider_providerOrderId: { provider: provider.id, providerOrderId: event.providerOrderId } },
  });

  if (!payment) {
    // Unrecognized order_id — nothing we can reconcile against, and this
    // won't change on retry either. Ack so the provider stops retrying.
    await recordEvent(null, event.rawType);
    return { duplicate: false, handled: false };
  }

  // Record the dedup event only *after* successfully applying it — if
  // applyVerifiedResult throws (amount mismatch, transient DB error), this
  // event is deliberately left unrecorded so a provider retry of the same
  // body gets a genuine second attempt instead of being swallowed as a
  // "duplicate" of a failed attempt.
  await applyVerifiedResult(payment, event);
  await recordEvent(payment.id, event.rawType);
  return { duplicate: false, handled: true };
}

// Admin-triggered only (enforced by the controller/route, not here) — a
// deliberate action, never an automatic side effect of changing order status.
//
// Refunds now always pay out to the customer's wallet rather than back
// through the gateway — a single atomic DB write, so this either fully
// succeeds (synchronously SUCCEEDED) or throws before anything is written.
// There's no provider round-trip to fail mid-flight anymore.
//
// An order can be funded from two independent pools now that checkout
// supports paying partly from the wallet and partly via the gateway (e.g.
// ₹200 wallet + ₹300 Cashfree on a ₹500 order): a gateway Payment row and/or
// a wallet debit WalletTransaction (type ORDER_PAYMENT) against this orderId.
// Both pools track their own "already refunded" total so a refund can draw
// from either or both without double-refunding or under-refunding either
// side — see the regression tests in __tests__/service.test.ts.
export async function refundPayment(
  orderId: string,
  amount: number,
  reason: string | undefined,
) {
  if (amount <= 0) {
    throw new RefundNotAllowedError("Refund amount must be greater than 0");
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new RefundNotAllowedError("Order not found");
  }

  // Included regardless of status (not just SUCCEEDED/PARTIALLY_REFUNDED) so
  // a fully REFUNDED payment still contributes its true gatewayPool/refunded
  // totals below — otherwise a split order whose gateway half was refunded
  // first would look like it never had a Payment at all, and the wallet-debit
  // pool's "already refunded" math would double-count the gateway refund.
  const payment = await prisma.payment.findFirst({
    where: {
      orderId,
      purpose: "ORDER_PAYMENT",
      status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] },
    },
    include: { refunds: true },
  });

  const walletDebit = await prisma.walletTransaction.aggregate({
    where: { orderId, type: "ORDER_PAYMENT" },
    _sum: { amount: true },
  });

  const gatewayPool = payment ? Number(payment.amount) : 0;
  const walletDebitPool = Math.abs(Number(walletDebit._sum.amount ?? 0));

  if (gatewayPool === 0 && walletDebitPool === 0) {
    throw new RefundNotAllowedError("No successful payment found for this order");
  }

  const gatewayRefundedSoFar = payment
    ? payment.refunds
        .filter((r) => REFUND_OPEN_STATUSES.includes(r.status))
        .reduce((sum, r) => sum + Number(r.amount), 0)
    : 0;

  const priorRefunds = await prisma.walletTransaction.aggregate({
    where: { orderId, type: "REFUND" },
    _sum: { amount: true },
  });
  // Every refund credit — from either pool — lands here, so subtracting the
  // Refund-table total (gateway pool only) isolates what came from the
  // wallet-debit pool specifically.
  const walletDebitRefundedSoFar = Number(priorRefunds._sum.amount ?? 0) - gatewayRefundedSoFar;

  const gatewayRefundable = Math.max(gatewayPool - gatewayRefundedSoFar, 0);
  const walletDebitRefundable = Math.max(walletDebitPool - walletDebitRefundedSoFar, 0);
  const totalRefundable = gatewayRefundable + walletDebitRefundable;

  if (amount > totalRefundable + 0.01) {
    const alreadyRefunded = gatewayPool + walletDebitPool - totalRefundable;
    throw new RefundNotAllowedError(
      `Refund amount must be between 0.01 and ${totalRefundable.toFixed(2)} (already refunded: ${alreadyRefunded.toFixed(2)})`,
    );
  }

  // Gateway pool first, wallet-debit pool for the rest — the split is
  // bookkeeping only (which pool's "already refunded" counter to decrement);
  // both ultimately just credit the customer's wallet.
  const fromGateway = Math.min(amount, gatewayRefundable);
  const fromWalletDebit = amount - fromGateway;

  return prisma.$transaction(async (tx) => {
    let gatewayRefund = null;

    if (fromGateway > 0 && payment) {
      const walletTransaction = await creditWalletForRefund(tx, order.userId, orderId, fromGateway, reason);
      gatewayRefund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          refundRef: `rfd_${randomUUID()}`,
          amount: fromGateway,
          reason,
          status: "SUCCEEDED",
          walletTransactionId: walletTransaction.id,
        },
      });

      const paymentStatus =
        gatewayRefundedSoFar + fromGateway >= gatewayPool - 0.01 ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await tx.payment.update({ where: { id: payment.id }, data: { status: paymentStatus } });
    }

    if (fromWalletDebit > 0) {
      await creditWalletForRefund(tx, order.userId, orderId, fromWalletDebit, reason);
    }

    return gatewayRefund ?? { orderId, amount, reason };
  });
}

export { WebhookSignatureError };
