"use client";

import { use, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { ALL_STATUSES, STATUS_STYLES } from "@/lib/order-helpers";
import { Order } from "@/types";

export default function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [order, setOrder] = useState<Order | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [status, setStatus] = useState<string>("");
  const [courier, setCourier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  function load() {
    api
      .get<Order>(`/admin/orders/${id}`)
      .then((o) => {
        setOrder(o);
        setStatus(o.status);
        setCourier(o.courier ?? "");
        setTrackingNumber(o.trackingNumber ?? "");
        setTrackingUrl(o.trackingUrl ?? "");
      })
      .catch(() => setNotFound(true));
  }

  useEffect(load, [id]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch(`/admin/orders/${id}`, {
        status,
        courier: courier.trim() || null,
        trackingNumber: trackingNumber.trim() || null,
        trackingUrl: trackingUrl.trim() || null,
      });
      load();
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRefund(e: FormEvent) {
    e.preventDefault();
    setRefunding(true);
    setRefundError(null);
    try {
      await api.post(`/admin/orders/${id}/refund`, {
        amount: Number(refundAmount),
        reason: refundReason.trim() || undefined,
      });
      setRefundAmount("");
      setRefundReason("");
      load();
    } catch (err) {
      setRefundError((err as Error).message);
    } finally {
      setRefunding(false);
    }
  }

  if (notFound) {
    return (
      <div className="space-y-4">
        <p className="font-mono text-sm text-foreground-muted">Order not found.</p>
        <Link
          href="/admin/orders"
          className="font-mono text-xs tracking-widest text-accent uppercase hover:underline"
        >
          Back to orders
        </Link>
      </div>
    );
  }

  if (!order) {
    return (
      <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
        Loading…
      </p>
    );
  }

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <Link
          href="/admin/orders"
          className="font-mono text-xs tracking-widest text-accent uppercase hover:underline"
        >
          ← Back to orders
        </Link>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
              Order #{order.id.slice(0, 8)}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {order.user?.name ?? "Unknown customer"}
            </h1>
            <p className="font-mono text-xs text-foreground-muted">{order.user?.email}</p>
          </div>
          <span
            className={`inline-block rounded-[var(--radius-card)] border px-3 py-1 font-mono text-xs tracking-widest uppercase ${
              STATUS_STYLES[order.status] ?? "border-border text-foreground-muted"
            }`}
          >
            {order.status}
          </span>
        </div>
      </div>

      <section>
        <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">Items</p>
        <ul className="mt-3 space-y-3">
          {order.items.map((item) => (
            <li
              key={item.id}
              className="flex gap-4 rounded-[var(--radius-card)] border border-border p-4"
            >
              <div className="h-20 w-16 shrink-0 overflow-hidden rounded-[var(--radius-card)] border border-border bg-background-elevated">
                {item.variant.product.images[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.variant.product.images[0]}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm text-foreground">{item.variant.product.name}</p>
                <p className="font-mono text-xs text-foreground-muted uppercase">
                  {item.variant.size} / {item.variant.color} × {item.quantity}
                </p>
                <p className="mt-1 font-mono text-sm text-foreground">₹{item.price}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4 font-mono text-sm">
          <span className="text-foreground-muted">Total</span>
          <span className="text-foreground">₹{order.totalAmount}</span>
        </div>
      </section>

      <section>
        <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
          Shipping Address
        </p>
        <div className="mt-3 rounded-[var(--radius-card)] border border-border px-5 py-4 text-sm text-foreground-muted">
          <p className="text-foreground">
            {order.shippingAddress.line1}
            {order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ""}
          </p>
          <p>
            {order.shippingAddress.city}, {order.shippingAddress.state}{" "}
            {order.shippingAddress.pincode}
          </p>
          <p>{order.shippingAddress.phone}</p>
        </div>
      </section>

      <section>
        <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
          Payment
        </p>
        {!order.payments || order.payments.length === 0 ? (
          <p className="mt-3 font-mono text-sm text-foreground-muted">
            No payment attempts recorded for this order.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {order.payments.map((payment) => (
              <li
                key={payment.id}
                className="rounded-[var(--radius-card)] border border-border px-5 py-4 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-foreground-muted">
                    {payment.provider} · {new Date(payment.createdAt).toLocaleString()}
                  </span>
                  <span
                    className={`inline-block rounded-[var(--radius-card)] border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase ${
                      STATUS_STYLES[payment.status] ?? "border-border text-foreground-muted"
                    }`}
                  >
                    {payment.status}
                  </span>
                </div>
                <p className="mt-1 text-foreground">
                  ₹{payment.amount} {payment.currency}
                </p>
                {payment.failureMessage && (
                  <p className="mt-1 font-mono text-xs text-danger">{payment.failureMessage}</p>
                )}
                {payment.refunds.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-border pt-2">
                    {payment.refunds.map((refund) => (
                      <li
                        key={refund.id}
                        className="font-mono text-[10px] text-foreground-muted uppercase"
                      >
                        Refund ₹{refund.amount} — {refund.status}
                        {refund.reason ? ` (${refund.reason})` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}

        {!order.payments?.length && order.walletTransactions && order.walletTransactions.length > 0 && (
          <ul className="mt-3 space-y-1">
            {order.walletTransactions.map((txn) => (
              <li key={txn.id} className="font-mono text-xs text-foreground-muted">
                Wallet {txn.type.toLowerCase().replace("_", " ")} ₹{Math.abs(Number(txn.amount)).toFixed(2)}
                {txn.reason ? ` (${txn.reason})` : ""}
              </li>
            ))}
          </ul>
        )}

        {(order.payments?.some((p) => p.status === "SUCCEEDED" || p.status === "PARTIALLY_REFUNDED") ||
          order.walletTransactions?.some((wt) => wt.type === "ORDER_PAYMENT")) && (
          <form onSubmit={handleRefund} className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="refundAmount"
                className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
              >
                Refund amount (₹)
              </label>
              <input
                id="refundAmount"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className="mt-2 w-32 rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
              />
            </div>
            <div>
              <label
                htmlFor="refundReason"
                className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
              >
                Reason (optional)
              </label>
              <input
                id="refundReason"
                type="text"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                className="mt-2 w-56 rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
              />
            </div>
            <button
              type="submit"
              disabled={refunding}
              className="rounded-[var(--radius-card)] border border-danger/50 px-4 py-2 font-mono text-xs tracking-widest text-danger uppercase hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refunding ? "Processing…" : "Issue refund"}
            </button>
            {refundError && (
              <p className="w-full font-mono text-xs text-danger">{refundError}</p>
            )}
          </form>
        )}
      </section>

      <section>
        <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
          Fulfillment
        </p>
        <form onSubmit={handleSave} className="mt-3 space-y-5">
          <div>
            <label
              htmlFor="status"
              className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
            >
              Status
            </label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-2 w-full max-w-xs rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            >
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <p className="mt-1 font-mono text-[10px] text-foreground-muted">
              Setting Cancelled or Refunded restocks the ordered variants (once).
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <div>
              <label
                htmlFor="courier"
                className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
              >
                Courier
              </label>
              <input
                id="courier"
                type="text"
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
                className="mt-2 w-full rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
              />
            </div>
            <div>
              <label
                htmlFor="trackingNumber"
                className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
              >
                Tracking number
              </label>
              <input
                id="trackingNumber"
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                className="mt-2 w-full rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
              />
            </div>
            <div>
              <label
                htmlFor="trackingUrl"
                className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
              >
                Tracking URL
              </label>
              <input
                id="trackingUrl"
                type="url"
                value={trackingUrl}
                onChange={(e) => setTrackingUrl(e.target.value)}
                className="mt-2 w-full rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
              />
            </div>
          </div>

          {error && <p className="font-mono text-xs text-danger">{error}</p>}
          {saved && !error && (
            <p className="font-mono text-xs tracking-widest text-accent uppercase">Saved</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="rounded-[var(--radius-card)] border border-accent px-6 py-3 font-mono text-xs tracking-widest text-accent uppercase hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>
      </section>
    </div>
  );
}
