"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { launchCheckout } from "@/lib/cashfree-checkout";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Wallet } from "@/types";

interface TopUpResponse {
  providerOrderId: string;
  sessionId: string | null;
}

const TRANSACTION_LABELS: Record<string, string> = {
  TOPUP: "Top up",
  ORDER_PAYMENT: "Order payment",
  REFUND: "Refund",
  ADMIN_CREDIT: "Credit",
  ADMIN_DEBIT: "Debit",
};

export default function WalletPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [amount, setAmount] = useState("");
  const [toppingUp, setToppingUp] = useState(false);
  const [topUpError, setTopUpError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    api
      .get<Wallet>("/wallet")
      .then(setWallet)
      .catch(() => setWallet(null));
  }, [user]);

  async function handleTopUp(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!value || value <= 0) return;

    setToppingUp(true);
    setTopUpError(null);
    try {
      const result = await api.post<TopUpResponse>("/wallet/topup", { amount: value });
      if (result.sessionId) {
        await launchCheckout(result.sessionId);
        // launchCheckout redirects the browser away; nothing after this runs.
        return;
      }
      setTopUpError("Could not start the top-up. Please try again.");
    } catch (err) {
      setTopUpError((err as Error).message);
    } finally {
      setToppingUp(false);
    }
  }

  if (authLoading || !user) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
          Loading…
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-16 px-6 py-10">
      <section className="bg-grid-lines relative overflow-hidden rounded-[var(--radius-card)] border border-border px-8 py-16 text-center">
        <p className="font-mono text-xs tracking-widest text-accent uppercase">Wallet</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          ₹{wallet ? Number(wallet.balance).toFixed(2) : "—"}
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">Available balance</p>
      </section>

      <section>
        <SectionHeading eyebrow="Add funds" title="Top Up" />
        <form onSubmit={handleTopUp} className="flex items-end gap-3">
          <div className="flex-1">
            <label
              htmlFor="amount"
              className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
            >
              Amount (₹)
            </label>
            <input
              id="amount"
              type="number"
              min="1"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-2 w-full rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>
          <button
            type="submit"
            disabled={toppingUp}
            className="rounded-[var(--radius-card)] border border-accent px-6 py-3 font-mono text-xs tracking-widest text-accent uppercase hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            {toppingUp ? "Starting…" : "Top up"}
          </button>
        </form>
        {topUpError && <p className="mt-3 font-mono text-xs text-danger">{topUpError}</p>}
      </section>

      <section>
        <SectionHeading eyebrow="History" title="Transactions" />
        {wallet === null ? (
          <p className="font-mono text-sm text-foreground-muted">Loading transactions…</p>
        ) : wallet.transactions.length === 0 ? (
          <p className="font-mono text-sm text-foreground-muted">No transactions yet.</p>
        ) : (
          <ul className="space-y-3">
            {wallet.transactions.map((txn) => {
              const signed = Number(txn.amount);
              return (
                <li
                  key={txn.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border px-5 py-4"
                >
                  <div>
                    <p className="text-sm text-foreground">
                      {TRANSACTION_LABELS[txn.type] ?? txn.type}
                    </p>
                    <p className="font-mono text-xs text-foreground-muted">
                      {new Date(txn.createdAt).toLocaleString()}
                      {txn.reason ? ` · ${txn.reason}` : ""}
                    </p>
                  </div>
                  <span
                    className={`font-mono text-sm ${signed < 0 ? "text-danger" : "text-accent"}`}
                  >
                    {signed > 0 ? "+" : ""}
                    ₹{signed.toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
