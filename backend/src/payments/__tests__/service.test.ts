import { beforeEach, describe, expect, it, vi } from "vitest";
// vitest hoists vi.mock() calls above all imports in this file (even this
// static one), so @/config/prisma and @/payments/factory are already mocked
// by the time @/payments/service's own top-level imports resolve them.
import {
  OrderNotPayableError,
  RefundNotAllowedError,
  handleWebhook,
  reconcilePaymentStatus,
  refundPayment,
  startPayment,
} from "@/payments/service";
import { adminAdjustWallet, debitWalletForOrder, InsufficientWalletBalanceError } from "@/wallet/service";

// A minimal in-memory stand-in for the slice of Prisma this module uses.
// Real end-to-end behavior (actual Postgres, actual Cashfree sandbox calls)
// was verified manually — see PAYMENTS.md — this covers the business rules
// in isolation, independent of any database or network.
interface FakeOrder {
  id: string;
  userId: string;
  status: string;
  totalAmount: number;
  shippingAddress: unknown;
}
interface FakePayment {
  id: string;
  orderId: string | null;
  purpose?: string;
  walletTransactionId?: string | null;
  provider: string;
  providerOrderId: string;
  providerPaymentId: string | null;
  amount: number;
  currency: string;
  status: string;
  idempotencyKey: string;
  sessionId: string | null;
  failureMessage?: string | null;
}
interface FakeWallet {
  id: string;
  userId: string;
  balance: number;
}
interface FakeWalletTransaction {
  id: string;
  walletId: string;
  type: string;
  status: string;
  amount: number;
  balanceAfter: number;
  reason?: string | null;
  orderId?: string | null;
  adminId?: string | null;
}

// vi.mock() factories are hoisted above *all* other top-level code in this
// file, including plain `const`/`function` declarations — so the fake DB
// they reference has to be built inside vi.hoisted(), which vitest hoists to
// that same position, instead of a later top-level `createFakeDb()` call.
function createFakeDb() {
  const orders = new Map<string, FakeOrder>();
  const payments = new Map<string, FakePayment>();
  const refunds = new Map<string, { id: string; paymentId: string; amount: number; status: string; walletTransactionId?: string | null }>();
  const webhookEvents = new Map<string, { provider: string; paymentId: string | null; type: string; bodyHash: string }>();
  const wallets = new Map<string, FakeWallet>();
  const walletTransactions = new Map<string, FakeWalletTransaction>();

  const client: Record<string, unknown> = {
    order: {
      findFirst: vi.fn(async ({ where, include }: { where: { id: string; userId?: string }; include?: Record<string, unknown> }) => {
        const o = orders.get(where.id);
        if (!o) return null;
        if (where.userId && o.userId !== where.userId) return null;
        const result: Record<string, unknown> = { ...o };
        if (include?.payments) {
          result.payments = [...payments.values()]
            .filter((p) => p.orderId === o.id)
            .sort((a, b) => b.id.localeCompare(a.id));
        }
        if (include?.user) result.user = { id: o.userId, name: "Test User", email: "t@example.com" };
        return result;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => orders.get(where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status?: string }; data: Partial<FakeOrder> }) => {
        const o = orders.get(where.id);
        if (!o || (where.status && o.status !== where.status)) return { count: 0 };
        Object.assign(o, data);
        return { count: 1 };
      }),
    },
    payment: {
      findUnique: vi.fn(
        async ({
          where,
          include,
        }: {
          where: { id?: string; provider_providerOrderId?: { provider: string; providerOrderId: string } };
          include?: { order?: boolean };
        }) => {
          let found: FakePayment | null = null;
          if (where.id) found = payments.get(where.id) ?? null;
          if (where.provider_providerOrderId) {
            const { provider, providerOrderId } = where.provider_providerOrderId;
            found =
              [...payments.values()].find((p) => p.provider === provider && p.providerOrderId === providerOrderId) ??
              null;
          }
          if (!found) return null;
          if (include?.order) {
            return { ...found, order: found.orderId ? orders.get(found.orderId) ?? null : null };
          }
          return found;
        },
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const p = payments.get(where.id);
        if (!p) throw new Error("Payment not found");
        return p;
      }),
      findFirst: vi.fn(async ({ where }: { where: { orderId: string; purpose?: string; status?: { in: string[] } } }) => {
        const match = [...payments.values()].find(
          (p) =>
            p.orderId === where.orderId &&
            (!where.purpose || p.purpose === where.purpose) &&
            (!where.status || where.status.in.includes(p.status)),
        );
        return match
          ? {
              ...match,
              refunds: [...refunds.values()].filter((r) => r.paymentId === match.id),
              order: match.orderId ? orders.get(match.orderId) ?? null : null,
            }
          : null;
      }),
      create: vi.fn(async ({ data }: { data: FakePayment }) => {
        const p = { purpose: "ORDER_PAYMENT", ...data };
        payments.set(p.id, p);
        return p;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakePayment> }) => {
        const p = payments.get(where.id)!;
        Object.assign(p, data);
        return p;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string | { not: string }; status?: string | { in: string[] }; orderId?: string };
          data: Partial<FakePayment>;
        }) => {
          let count = 0;
          for (const p of payments.values()) {
            if (where.orderId && p.orderId !== where.orderId) continue;
            if (typeof where.id === "string" && p.id !== where.id) continue;
            if (where.id && typeof where.id === "object" && p.id === where.id.not) continue;
            if (typeof where.status === "string" && p.status !== where.status) continue;
            if (where.status && typeof where.status === "object" && !where.status.in.includes(p.status)) continue;
            Object.assign(p, data);
            count++;
          }
          return { count };
        },
      ),
    },
    refund: {
      create: vi.fn(async ({ data }: { data: { paymentId: string; amount: number } }) => {
        const r = { id: `refund_${refunds.size + 1}`, status: "PENDING", ...data };
        refunds.set(r.id, r);
        return r;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = refunds.get(where.id)!;
        Object.assign(r, data);
        return r;
      }),
    },
    paymentWebhookEvent: {
      findUnique: vi.fn(async ({ where }: { where: { provider_bodyHash: { provider: string; bodyHash: string } } }) => {
        const key = `${where.provider_bodyHash.provider}:${where.provider_bodyHash.bodyHash}`;
        return webhookEvents.get(key) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: { provider: string; paymentId: string | null; type: string; bodyHash: string } }) => {
        webhookEvents.set(`${data.provider}:${data.bodyHash}`, data);
        return data;
      }),
    },
    wallet: {
      upsert: vi.fn(async ({ where, create }: { where: { userId: string }; create: { userId: string; balance: number } }) => {
        let w = [...wallets.values()].find((x) => x.userId === where.userId);
        if (!w) {
          w = { id: `wallet_${wallets.size + 1}`, userId: where.userId, balance: create.balance ?? 0 };
          wallets.set(w.id, w);
        }
        return w;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; balance?: { gte: number } };
          data: { balance: { increment: number } };
        }) => {
          const w = wallets.get(where.id);
          if (!w) return { count: 0 };
          if (where.balance?.gte !== undefined && w.balance < where.balance.gte) return { count: 0 };
          w.balance += data.balance.increment;
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const w = wallets.get(where.id);
        if (!w) throw new Error("Wallet not found");
        return w;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: { balance: { increment: number } } }) => {
          const w = wallets.get(where.id)!;
          w.balance += data.balance.increment;
          return w;
        },
      ),
    },
    walletTransaction: {
      create: vi.fn(async ({ data }: { data: Omit<FakeWalletTransaction, "id"> }) => {
        const wt = { id: `wt_${walletTransactions.size + 1}`, ...data };
        walletTransactions.set(wt.id, wt);
        return wt;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const wt = walletTransactions.get(where.id);
        if (!wt) throw new Error("WalletTransaction not found");
        return wt;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: string };
          data: Partial<FakeWalletTransaction>;
        }) => {
          const wt = walletTransactions.get(where.id);
          if (!wt) return { count: 0 };
          if (where.status && wt.status !== where.status) return { count: 0 };
          Object.assign(wt, data);
          return { count: 1 };
        },
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<FakeWalletTransaction> }) => {
          const wt = walletTransactions.get(where.id)!;
          Object.assign(wt, data);
          return wt;
        },
      ),
      findFirst: vi.fn(async ({ where }: { where: { orderId?: string; type?: string } }) => {
        return (
          [...walletTransactions.values()].find(
            (wt) =>
              (!where.orderId || wt.orderId === where.orderId) &&
              (!where.type || wt.type === where.type),
          ) ?? null
        );
      }),
      aggregate: vi.fn(async ({ where }: { where: { orderId?: string; type?: string } }) => {
        const matches = [...walletTransactions.values()].filter(
          (wt) =>
            (!where.orderId || wt.orderId === where.orderId) &&
            (!where.type || wt.type === where.type),
        );
        return { _sum: { amount: matches.length ? matches.reduce((s, wt) => s + wt.amount, 0) : null } };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(client)),
  };

  return { client, orders, payments, refunds, webhookEvents, wallets, walletTransactions };
}

const db = vi.hoisted(() => createFakeDb());

vi.mock("@/config/prisma", () => ({ prisma: db.client }));

const mockProvider = vi.hoisted(() => ({
  id: "CASHFREE" as const,
  createPayment: vi.fn(),
  getPaymentStatus: vi.fn(),
  verifyWebhook: vi.fn(),
  refundPayment: vi.fn(),
}));
vi.mock("@/payments/factory", () => ({ getPaymentProvider: () => mockProvider }));

function seedOrderWithPayment(opts: {
  orderId: string;
  paymentId: string;
  amount: number;
  status: string;
  orderStatus?: string;
}) {
  db.orders.set(opts.orderId, {
    id: opts.orderId,
    userId: "user1",
    status: opts.orderStatus ?? "PENDING",
    totalAmount: opts.amount,
    shippingAddress: {},
  });
  db.payments.set(opts.paymentId, {
    id: opts.paymentId,
    orderId: opts.orderId,
    purpose: "ORDER_PAYMENT",
    provider: "CASHFREE",
    providerOrderId: `pay_${opts.paymentId}`,
    providerPaymentId: null,
    amount: opts.amount,
    currency: "INR",
    status: opts.status,
    idempotencyKey: `idem_${opts.paymentId}`,
    sessionId: null,
  });
}

describe("payments service", () => {
  beforeEach(() => {
    db.orders.clear();
    db.payments.clear();
    db.refunds.clear();
    db.webhookEvents.clear();
    db.wallets.clear();
    db.walletTransactions.clear();
    vi.clearAllMocks();
  });

  describe("handleWebhook", () => {
    it("marks the payment SUCCEEDED and the order PAID on a verified success event", async () => {
      seedOrderWithPayment({ orderId: "o1", paymentId: "p1", amount: 500, status: "PENDING" });
      mockProvider.verifyWebhook.mockResolvedValue({
        rawType: "PAYMENT_SUCCESS_WEBHOOK",
        providerOrderId: "pay_p1",
        providerPaymentId: "cfp1",
        status: "SUCCEEDED",
        amount: 500,
        currency: "INR",
      });

      const result = await handleWebhook({
        rawBody: "{}",
        signature: "sig",
        timestamp: "1",
        bodyHash: "hash1",
      });

      expect(result).toEqual({ duplicate: false, handled: true });
      expect(db.payments.get("p1")!.status).toBe("SUCCEEDED");
      expect(db.orders.get("o1")!.status).toBe("PAID");
    });

    it("cancels sibling payment attempts once one succeeds", async () => {
      seedOrderWithPayment({ orderId: "o1", paymentId: "p1", amount: 500, status: "PENDING" });
      seedOrderWithPayment({ orderId: "o1", paymentId: "p2", amount: 500, status: "PENDING" });
      mockProvider.verifyWebhook.mockResolvedValue({
        rawType: "PAYMENT_SUCCESS_WEBHOOK",
        providerOrderId: "pay_p2",
        providerPaymentId: "cfp2",
        status: "SUCCEEDED",
        amount: 500,
        currency: "INR",
      });

      await handleWebhook({ rawBody: "{}", signature: "sig", timestamp: "1", bodyHash: "hash1" });

      expect(db.payments.get("p2")!.status).toBe("SUCCEEDED");
      expect(db.payments.get("p1")!.status).toBe("CANCELLED");
    });

    it("rejects a webhook whose amount does not match the stored payment", async () => {
      seedOrderWithPayment({ orderId: "o1", paymentId: "p1", amount: 500, status: "PENDING" });
      mockProvider.verifyWebhook.mockResolvedValue({
        rawType: "PAYMENT_SUCCESS_WEBHOOK",
        providerOrderId: "pay_p1",
        providerPaymentId: "cfp1",
        status: "SUCCEEDED",
        amount: 1, // attacker/bug claiming a far smaller amount was paid
        currency: "INR",
      });

      await expect(
        handleWebhook({ rawBody: "{}", signature: "sig", timestamp: "1", bodyHash: "hash1" }),
      ).rejects.toThrow(/amount mismatch/);

      expect(db.payments.get("p1")!.status).toBe("PENDING");
      expect(db.orders.get("o1")!.status).toBe("PENDING");
    });

    it("does not record the event when processing fails, so a retry gets a real second attempt", async () => {
      seedOrderWithPayment({ orderId: "o1", paymentId: "p1", amount: 500, status: "PENDING" });
      mockProvider.verifyWebhook.mockResolvedValue({
        rawType: "PAYMENT_SUCCESS_WEBHOOK",
        providerOrderId: "pay_p1",
        providerPaymentId: "cfp1",
        status: "SUCCEEDED",
        amount: 1,
        currency: "INR",
      });

      await expect(
        handleWebhook({ rawBody: "{}", signature: "sig", timestamp: "1", bodyHash: "hash1" }),
      ).rejects.toThrow();

      const retry = await handleWebhook({
        rawBody: "{}",
        signature: "sig",
        timestamp: "1",
        bodyHash: "hash1",
      }).catch((e) => e);
      // Still a genuine retry attempt (another thrown mismatch), not a
      // silently-swallowed "duplicate" response.
      expect(retry).toBeInstanceOf(Error);
    });

    it("ignores a duplicate delivery of an already-processed event", async () => {
      seedOrderWithPayment({ orderId: "o1", paymentId: "p1", amount: 500, status: "PENDING" });
      mockProvider.verifyWebhook.mockResolvedValue({
        rawType: "PAYMENT_SUCCESS_WEBHOOK",
        providerOrderId: "pay_p1",
        providerPaymentId: "cfp1",
        status: "SUCCEEDED",
        amount: 500,
        currency: "INR",
      });

      await handleWebhook({ rawBody: "{}", signature: "sig", timestamp: "1", bodyHash: "hash1" });
      const second = await handleWebhook({
        rawBody: "{}",
        signature: "sig",
        timestamp: "1",
        bodyHash: "hash1",
      });

      expect(second).toEqual({ duplicate: true, handled: false });
      expect(mockProvider.verifyWebhook).toHaveBeenCalledTimes(1);
    });

    it("does not let a late/out-of-order failure regress an already-succeeded payment", async () => {
      seedOrderWithPayment({ orderId: "o1", paymentId: "p1", amount: 500, status: "SUCCEEDED", orderStatus: "PAID" });
      mockProvider.verifyWebhook.mockResolvedValue({
        rawType: "PAYMENT_FAILED_WEBHOOK",
        providerOrderId: "pay_p1",
        providerPaymentId: "cfp1",
        status: "FAILED",
        amount: 500,
        currency: "INR",
      });

      const result = await handleWebhook({
        rawBody: "{}",
        signature: "sig",
        timestamp: "1",
        bodyHash: "hash-late",
      });

      expect(result).toEqual({ duplicate: false, handled: true });
      expect(db.payments.get("p1")!.status).toBe("SUCCEEDED");
      expect(db.orders.get("o1")!.status).toBe("PAID");
    });
  });

  describe("startPayment", () => {
    it("nets out a prior wallet debit so the gateway is only asked for the remainder", async () => {
      db.orders.set("o5", { id: "o5", userId: "user5", status: "PENDING", totalAmount: 500, shippingAddress: {} });
      db.walletTransactions.set("debit5", {
        id: "debit5",
        walletId: "wallet_placeholder",
        type: "ORDER_PAYMENT",
        status: "COMPLETED",
        amount: -200,
        balanceAfter: 0,
        orderId: "o5",
      });
      mockProvider.createPayment.mockResolvedValue({ sessionId: "sess1", providerRefId: "ref1" });

      await startPayment("o5", "user5");

      expect(mockProvider.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 300 }),
      );
      const created = [...db.payments.values()].find((p) => p.orderId === "o5");
      expect(Number(created?.amount)).toBe(300);
    });

    it("refuses to start a gateway payment once the wallet already covers the full order", async () => {
      db.orders.set("o6", { id: "o6", userId: "user6", status: "PENDING", totalAmount: 500, shippingAddress: {} });
      db.walletTransactions.set("debit6", {
        id: "debit6",
        walletId: "wallet_placeholder",
        type: "ORDER_PAYMENT",
        status: "COMPLETED",
        amount: -500,
        balanceAfter: 0,
        orderId: "o6",
      });

      await expect(startPayment("o6", "user6")).rejects.toBeInstanceOf(OrderNotPayableError);
    });
  });

  describe("reconcilePaymentStatus", () => {
    it("rejects a customer looking up another customer's payment", async () => {
      seedOrderWithPayment({ orderId: "o1", paymentId: "p1", amount: 500, status: "PENDING" });
      await expect(reconcilePaymentStatus("pay_p1", "someone-else")).rejects.toThrow(
        "Payment not found",
      );
    });
  });

  describe("refundPayment", () => {
    it("rejects when no successful payment exists for the order", async () => {
      seedOrderWithPayment({ orderId: "o1", paymentId: "p1", amount: 500, status: "FAILED" });
      await expect(refundPayment("o1", 100, undefined)).rejects.toBeInstanceOf(RefundNotAllowedError);
    });

    it("rejects a refund amount exceeding the refundable balance", async () => {
      seedOrderWithPayment({ orderId: "o1", paymentId: "p1", amount: 500, status: "SUCCEEDED", orderStatus: "PAID" });
      await expect(refundPayment("o1", 501, undefined)).rejects.toThrow(/must be between/);
    });

    it("accepts a valid partial refund and marks the payment PARTIALLY_REFUNDED", async () => {
      seedOrderWithPayment({ orderId: "o1", paymentId: "p1", amount: 500, status: "SUCCEEDED", orderStatus: "PAID" });
      mockProvider.refundPayment.mockResolvedValue({ providerRefundId: "rfd1", status: "SUCCEEDED" });

      await refundPayment("o1", 200, "customer request");

      expect(db.payments.get("p1")!.status).toBe("PARTIALLY_REFUNDED");
    });

    it("prevents a second refund from exceeding what remains after a prior one", async () => {
      seedOrderWithPayment({ orderId: "o1", paymentId: "p1", amount: 500, status: "SUCCEEDED", orderStatus: "PAID" });
      mockProvider.refundPayment.mockResolvedValue({ providerRefundId: "rfd1", status: "SUCCEEDED" });
      await refundPayment("o1", 300, undefined);

      // payment is now PARTIALLY_REFUNDED with 300 already refunded; only 200 left
      await expect(refundPayment("o1", 201, undefined)).rejects.toThrow(/must be between/);
    });

    it("credits the wallet instead of calling the provider for a gateway-funded order", async () => {
      seedOrderWithPayment({ orderId: "o1", paymentId: "p1", amount: 500, status: "SUCCEEDED", orderStatus: "PAID" });

      await refundPayment("o1", 200, "customer request");

      expect(db.payments.get("p1")!.status).toBe("PARTIALLY_REFUNDED");
      expect(mockProvider.refundPayment).not.toHaveBeenCalled();
      const wallet = [...db.wallets.values()].find((w) => w.userId === "user1");
      expect(wallet?.balance).toBe(200);
    });

    it("credits the wallet for an order paid entirely from the wallet (no Payment row)", async () => {
      db.orders.set("o2", { id: "o2", userId: "user2", status: "PAID", totalAmount: 300, shippingAddress: {} });
      db.walletTransactions.set("debit1", {
        id: "debit1",
        walletId: "wallet_placeholder",
        type: "ORDER_PAYMENT",
        status: "COMPLETED",
        amount: -300,
        balanceAfter: 0,
        orderId: "o2",
      });

      await refundPayment("o2", 100, "goodwill");

      const wallet = [...db.wallets.values()].find((w) => w.userId === "user2");
      expect(wallet?.balance).toBe(100);

      // only 200 remains refundable (300 total - 100 already refunded)
      await expect(refundPayment("o2", 201, undefined)).rejects.toThrow(/must be between/);
    });

    it("rejects a refund for an order that was never paid at all", async () => {
      db.orders.set("o3", { id: "o3", userId: "user3", status: "PENDING", totalAmount: 100, shippingAddress: {} });
      await expect(refundPayment("o3", 50, undefined)).rejects.toBeInstanceOf(RefundNotAllowedError);
    });

    describe("split wallet + gateway order", () => {
      function seedSplitOrder() {
        // ₹500 order: ₹200 from the wallet, ₹300 via a (now-succeeded) gateway payment.
        db.orders.set("o4", { id: "o4", userId: "user4", status: "PAID", totalAmount: 500, shippingAddress: {} });
        db.payments.set("p4", {
          id: "p4",
          orderId: "o4",
          purpose: "ORDER_PAYMENT",
          provider: "CASHFREE",
          providerOrderId: "pay_p4",
          providerPaymentId: null,
          amount: 300,
          currency: "INR",
          status: "SUCCEEDED",
          idempotencyKey: "idem_p4",
          sessionId: null,
        });
        db.walletTransactions.set("debit4", {
          id: "debit4",
          walletId: "wallet_placeholder",
          type: "ORDER_PAYMENT",
          status: "COMPLETED",
          amount: -200,
          balanceAfter: 0,
          orderId: "o4",
        });
      }

      it("draws a refund from the gateway pool first, then the wallet-debit pool", async () => {
        seedSplitOrder();

        await refundPayment("o4", 100, "partial");
        expect(db.payments.get("p4")!.status).toBe("PARTIALLY_REFUNDED");
        let wallet = [...db.wallets.values()].find((w) => w.userId === "user4");
        expect(wallet?.balance).toBe(100);

        // Gateway pool had 200 left (300 - 100); this refund exhausts it (200)
        // and draws the remaining 50 from the wallet-debit pool.
        await refundPayment("o4", 250, "rest");
        expect(db.payments.get("p4")!.status).toBe("REFUNDED");
        wallet = [...db.wallets.values()].find((w) => w.userId === "user4");
        expect(wallet?.balance).toBe(350);

        // 500 total - 350 already refunded = 150 left (all wallet-debit pool).
        await expect(refundPayment("o4", 151, undefined)).rejects.toThrow(/must be between/);
        await refundPayment("o4", 150, undefined);
        wallet = [...db.wallets.values()].find((w) => w.userId === "user4");
        expect(wallet?.balance).toBe(500);
      });
    });
  });

  describe("wallet top-ups", () => {
    function seedTopUp(opts: { paymentId: string; userId: string; amount: number; status?: string }) {
      const wallet: FakeWallet = { id: `wallet_${opts.userId}`, userId: opts.userId, balance: 0 };
      db.wallets.set(wallet.id, wallet);
      const wt: FakeWalletTransaction = {
        id: `wt_${opts.paymentId}`,
        walletId: wallet.id,
        type: "TOPUP",
        status: "PENDING",
        amount: opts.amount,
        balanceAfter: wallet.balance,
      };
      db.walletTransactions.set(wt.id, wt);
      db.payments.set(opts.paymentId, {
        id: opts.paymentId,
        orderId: null,
        purpose: "WALLET_TOPUP",
        walletTransactionId: wt.id,
        provider: "CASHFREE",
        providerOrderId: `topup_${opts.paymentId}`,
        providerPaymentId: null,
        amount: opts.amount,
        currency: "INR",
        status: opts.status ?? "PENDING",
        idempotencyKey: `idem_${opts.paymentId}`,
        sessionId: null,
      });
      return { wallet, wt };
    }

    it("credits the wallet on a successful top-up webhook", async () => {
      const { wallet } = seedTopUp({ paymentId: "t1", userId: "user1", amount: 200 });
      mockProvider.verifyWebhook.mockResolvedValue({
        rawType: "PAYMENT_SUCCESS_WEBHOOK",
        providerOrderId: "topup_t1",
        providerPaymentId: "cfp1",
        status: "SUCCEEDED",
        amount: 200,
        currency: "INR",
      });

      await handleWebhook({ rawBody: "{}", signature: "sig", timestamp: "1", bodyHash: "hash-topup" });

      expect(db.payments.get("t1")!.status).toBe("SUCCEEDED");
      expect(db.wallets.get(wallet.id)!.balance).toBe(200);
    });

    // Regression test for the one genuinely dangerous interaction between
    // ORDER_PAYMENT and WALLET_TOPUP sharing the Payment table: the
    // sibling-cancellation query in applyVerifiedResult must be scoped to
    // purpose === ORDER_PAYMENT, or it matches every other user's pending
    // top-up (all have orderId === null) and cancels them all.
    it("does not cancel another user's pending top-up when one succeeds", async () => {
      seedTopUp({ paymentId: "t1", userId: "userA", amount: 100 });
      seedTopUp({ paymentId: "t2", userId: "userB", amount: 150 });

      mockProvider.verifyWebhook.mockResolvedValue({
        rawType: "PAYMENT_SUCCESS_WEBHOOK",
        providerOrderId: "topup_t1",
        providerPaymentId: "cfp1",
        status: "SUCCEEDED",
        amount: 100,
        currency: "INR",
      });

      await handleWebhook({ rawBody: "{}", signature: "sig", timestamp: "1", bodyHash: "hash-a" });

      expect(db.payments.get("t1")!.status).toBe("SUCCEEDED");
      expect(db.payments.get("t2")!.status).toBe("PENDING");
    });

    it("marks the top-up FAILED without touching the balance on a failed webhook", async () => {
      const { wallet } = seedTopUp({ paymentId: "t1", userId: "user1", amount: 200 });
      mockProvider.verifyWebhook.mockResolvedValue({
        rawType: "PAYMENT_FAILED_WEBHOOK",
        providerOrderId: "topup_t1",
        providerPaymentId: "cfp1",
        status: "FAILED",
        amount: 200,
        currency: "INR",
      });

      await handleWebhook({ rawBody: "{}", signature: "sig", timestamp: "1", bodyHash: "hash-fail" });

      expect(db.payments.get("t1")!.status).toBe("FAILED");
      expect(db.walletTransactions.get("wt_t1")!.status).toBe("FAILED");
      expect(db.wallets.get(wallet.id)!.balance).toBe(0);
    });
  });

  describe("wallet debits (checkout)", () => {
    it("rejects a debit exceeding the current balance, leaving the balance unchanged", async () => {
      db.wallets.set("w1", { id: "w1", userId: "user1", balance: 100 });
      await expect(
        debitWalletForOrder(db.client as unknown as Parameters<typeof debitWalletForOrder>[0], "user1", "o1", 150),
      ).rejects.toBeInstanceOf(InsufficientWalletBalanceError);
      expect(db.wallets.get("w1")!.balance).toBe(100);
    });

    it("debits exactly the order amount on success", async () => {
      db.wallets.set("w1", { id: "w1", userId: "user1", balance: 500 });
      await debitWalletForOrder(db.client as unknown as Parameters<typeof debitWalletForOrder>[0], "user1", "o1", 200);
      expect(db.wallets.get("w1")!.balance).toBe(300);
    });
  });

  describe("adminAdjustWallet", () => {
    it("rejects an ADMIN_DEBIT that would take the balance below zero", async () => {
      db.wallets.set("w1", { id: "w1", userId: "user1", balance: 50 });
      await expect(
        adminAdjustWallet("user1", 100, "ADMIN_DEBIT", "test", "admin1"),
      ).rejects.toBeInstanceOf(InsufficientWalletBalanceError);
      expect(db.wallets.get("w1")!.balance).toBe(50);
    });

    it("records the acting admin's id on an ADMIN_CREDIT", async () => {
      db.wallets.set("w1", { id: "w1", userId: "user1", balance: 0 });
      const txn = await adminAdjustWallet("user1", 75, "ADMIN_CREDIT", "goodwill", "admin1");
      expect(db.wallets.get("w1")!.balance).toBe(75);
      expect(txn.adminId).toBe("admin1");
    });
  });
});
