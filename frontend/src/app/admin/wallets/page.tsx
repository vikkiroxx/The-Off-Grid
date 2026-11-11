"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Wallet } from "@/types";

export default function AdminWalletsPage() {
  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api
      .get<Wallet[]>("/admin/wallets")
      .then(setWallets)
      .catch((err) => setError((err as Error).message));
  }, []);

  const filtered = wallets?.filter((w) =>
    `${w.user?.name ?? ""} ${w.user?.email ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs tracking-widest text-accent uppercase">Admin</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Wallets
        </h1>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by customer name or email…"
        className="w-full max-w-sm rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
      />

      {error && <p className="font-mono text-xs text-danger">{error}</p>}

      {!wallets ? (
        <p className="font-mono text-sm text-foreground-muted">Loading…</p>
      ) : filtered!.length === 0 ? (
        <p className="font-mono text-sm text-foreground-muted">No wallets found.</p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border font-mono text-[10px] tracking-widest text-foreground-muted uppercase">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered!.map((wallet) => (
                <tr key={wallet.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3">
                    <p className="text-foreground">{wallet.user?.name ?? "—"}</p>
                    <p className="font-mono text-[10px] text-foreground-muted">
                      {wallet.user?.email}
                    </p>
                  </td>
                  <td className="px-4 py-3 font-mono text-foreground-muted">
                    ₹{Number(wallet.balance).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/wallets/${wallet.user?.id}`}
                      className="font-mono text-[10px] tracking-widest text-accent uppercase hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
