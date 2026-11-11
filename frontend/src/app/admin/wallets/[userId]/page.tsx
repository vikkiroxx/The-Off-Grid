"use client";

import { use, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Wallet } from "@/types";

const TRANSACTION_LABELS: Record<string, string> = {
  TOPUP: "Top up",
  ORDER_PAYMENT: "Order payment",
  REFUND: "Refund",
  ADMIN_CREDIT: "Credit",
  ADMIN_DEBIT: "Debit",
};

export default function AdminWalletDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"ADMIN_CREDIT" | "ADMIN_DEBIT">("ADMIN_CREDIT");
  const [reason, setReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  function load() {
    api
      .get<Wallet>(`/admin/wallets/${userId}`)
      .then(setWallet)
      .catch(() => setNotFound(true));
  }

  useEffect(load, [userId]);

  async function handleAdjust(e: FormEvent) {
    e.preventDefault();
    setAdjusting(true);
    setAdjustError(null);
    try {
      await api.post(`/admin/wallets/${userId}/adjust`, {
        amount: Number(amount),
        type,
        reason: reason.trim() || undefined,
      });
      setAmount("");
      setReason("");
      load();
    } catch (err) {
      setAdjustError((err as Error).message);
    } finally {
      setAdjusting(false);
    }
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <p className="font-mono text-sm text-foreground-muted">Wallet not found.</p>
        <Link
          href="/admin/wallets"
          className="font-mono text-xs tracking-widest text-accent uppercase hover:underline"
        >
          ← Back to wallets
        </Link>
      </div>
    );
  }

  if (!wallet) {
    return <p className="font-mono text-sm text-foreground-muted">Loading…</p>;
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <Link
          href="/admin/wallets"
          className="font-mono text-xs tracking-widest text-accent uppercase hover:underline"
        >
          ← Back to wallets
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {wallet.user?.name ?? "Wallet"}
        </h1>
        <p className="font-mono text-xs text-foreground-muted">{wallet.user?.email}</p>
      </div>

      <section className="rounded-[var(--radius-card)] border border-border px-5 py-4">
        <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
          Balance
        </p>
        <p className="mt-1 text-2xl font-bold text-foreground">
          ₹{Number(wallet.balance).toFixed(2)}
        </p>
      </section>

      <section>
        <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
          Adjust balance
        </p>
        <form onSubmit={handleAdjust} className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="adjustAmount"
              className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
            >
              Amount (₹)
            </label>
            <input
              id="adjustAmount"
              type="number"
              min="0.01"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-2 w-32 rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>
          <div>
            <label
              htmlFor="adjustType"
              className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
            >
              Type
            </label>
            <select
              id="adjustType"
              value={type}
              onChange={(e) => setType(e.target.value as "ADMIN_CREDIT" | "ADMIN_DEBIT")}
              className="mt-2 rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            >
              <option value="ADMIN_CREDIT">Credit</option>
              <option value="ADMIN_DEBIT">Debit</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="adjustReason"
              className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
            >
              Reason (optional)
            </label>
            <input
              id="adjustReason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-2 w-56 rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>
          <button
            type="submit"
            disabled={adjusting}
            className="rounded-[var(--radius-card)] border border-accent px-6 py-3 font-mono text-xs tracking-widest text-accent uppercase hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            {adjusting ? "Saving…" : "Apply"}
          </button>
          {adjustError && <p className="w-full font-mono text-xs text-danger">{adjustError}</p>}
        </form>
      </section>

      <section>
        <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
          Transactions
        </p>
        {wallet.transactions.length === 0 ? (
          <p className="mt-3 font-mono text-sm text-foreground-muted">No transactions yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {wallet.transactions.map((txn) => {
              const signed = Number(txn.amount);
              return (
                <li
                  key={txn.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border px-5 py-4 text-sm"
                >
                  <div>
                    <p className="text-foreground">{TRANSACTION_LABELS[txn.type] ?? txn.type}</p>
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
    </div>
  );
}
