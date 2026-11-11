"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useCart } from "@/lib/cart-context";
import { api } from "@/lib/api";
import { launchCheckout } from "@/lib/cashfree-checkout";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Order, Wallet } from "@/types";

interface CheckoutResponse extends Order {
  payment: { providerOrderId: string; sessionId: string | null } | null;
  paymentError?: string;
}

type PaymentMethod = "CASHFREE" | "WALLET";

function unitPrice(item: { variant: { priceDelta: string; product: { price: string } } }) {
  return Number(item.variant.product.price) + Number(item.variant.priceDelta);
}

export default function CartPage() {
  const { user, loading: authLoading, refresh: refreshAuth } = useAuth();
  const {
    items,
    loading: cartLoading,
    updateQuantity,
    removeItem,
    refresh: refreshCart,
  } = useCart();
  const router = useRouter();

  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASHFREE");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (user) refreshAuth();
    // Only re-fetch the full profile (addresses) when the logged-in user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const addresses = user?.addresses ?? [];
    if (addresses.length === 0) {
      // Seeding the radio selection from the loaded addresses, not a derived value.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedAddressId(null);
      return;
    }
    if (!addresses.some((a) => a.id === selectedAddressId)) {
      setSelectedAddressId(addresses.find((a) => a.isDefault)?.id ?? addresses[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.addresses]);

  async function handleQuantityChange(itemId: string, quantity: number) {
    if (quantity < 1) return;
    setPendingItemId(itemId);
    try {
      await updateQuantity(itemId, quantity);
    } finally {
      setPendingItemId(null);
    }
  }

  async function handleRemove(itemId: string) {
    setPendingItemId(itemId);
    try {
      await removeItem(itemId);
    } finally {
      setPendingItemId(null);
    }
  }

  async function handleCheckout() {
    const address = user?.addresses?.find((a) => a.id === selectedAddressId);
    if (!address) return;

    setPlacing(true);
    setPlaceError(null);
    try {
      const order = await api.post<CheckoutResponse>("/orders", {
        shippingAddress: {
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          state: address.state,
          pincode: address.pincode,
          phone: address.phone,
        },
        paymentMethod,
      });
      // The order is placed (and stock/cart already updated server-side)
      // regardless of what happens next — refresh the cart either way.
      await refreshCart();

      if (order.status === "PAID") {
        // Paid synchronously from the wallet — no gateway round-trip.
        router.push(`/orders/${order.id}`);
        return;
      }

      if (order.payment?.sessionId) {
        await launchCheckout(order.payment.sessionId);
        // launchCheckout redirects the browser away; nothing after this runs.
        return;
      }

      // Order placed, but payment couldn't start (gateway hiccup) — send the
      // customer to the order page, where they can retry payment.
      router.push(`/orders/${order.id}`);
    } catch (err) {
      setPlaceError((err as Error).message);
    } finally {
      setPlacing(false);
    }
  }

  const subtotal = items.reduce((sum, item) => sum + unitPrice(item) * item.quantity, 0);
  const walletUsable = Boolean(wallet) && Number(wallet?.balance ?? 0) >= subtotal;

  useEffect(() => {
    if (paymentMethod === "WALLET" && !walletUsable) {
      // Falling back the selection when the wallet option becomes unusable
      // (e.g. cart total changed), not a derived value.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPaymentMethod("CASHFREE");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletUsable]);

  if (authLoading || !user) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
          Loading…
        </p>
      </main>
    );
  }

  const addresses = user.addresses ?? [];

  return (
    <main className="mx-auto max-w-3xl space-y-12 px-6 py-10">
      <div>
        <p className="font-mono text-xs tracking-widest text-accent uppercase">Cart</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Your Bag
        </h1>
      </div>

      {cartLoading ? (
        <p className="font-mono text-sm text-foreground-muted">Loading cart…</p>
      ) : items.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-border px-8 py-16 text-center">
          <p className="font-mono text-sm text-foreground-muted">Your cart is empty.</p>
          <Link
            href="/products"
            className="mt-6 inline-block rounded-[var(--radius-card)] border border-accent px-6 py-3 font-mono text-xs tracking-widest text-accent uppercase hover:bg-accent-soft"
          >
            Browse products
          </Link>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex gap-4 rounded-[var(--radius-card)] border border-border p-4"
              >
                <div className="h-24 w-20 shrink-0 overflow-hidden rounded-[var(--radius-card)] border border-border bg-background-elevated">
                  {item.variant.product.images[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.variant.product.images[0]}
                      alt={item.variant.product.name}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>

                <div className="flex flex-1 flex-col justify-between">
                  <div>
                    <p className="text-sm text-foreground">{item.variant.product.name}</p>
                    <p className="font-mono text-xs text-foreground-muted uppercase">
                      {item.variant.size} / {item.variant.color}
                    </p>
                    <p className="mt-1 font-mono text-sm text-foreground">
                      ₹{unitPrice(item).toFixed(2)}
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center rounded-[var(--radius-card)] border border-border">
                      <button
                        type="button"
                        disabled={pendingItemId === item.id}
                        onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                        className="px-3 py-1 font-mono text-foreground-muted hover:text-foreground disabled:opacity-50"
                      >
                        −
                      </button>
                      <span className="w-8 text-center font-mono text-sm text-foreground">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        disabled={pendingItemId === item.id}
                        onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                        className="px-3 py-1 font-mono text-foreground-muted hover:text-foreground disabled:opacity-50"
                      >
                        +
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={pendingItemId === item.id}
                      onClick={() => handleRemove(item.id)}
                      className="font-mono text-[10px] tracking-widest text-foreground-muted uppercase hover:text-danger disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <section>
            <SectionHeading eyebrow="Checkout" title="Order Summary" />

            <div className="flex items-center justify-between font-mono text-sm">
              <span className="text-foreground-muted">Subtotal</span>
              <span className="text-foreground">₹{subtotal.toFixed(2)}</span>
            </div>

            <div className="mt-6">
              <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
                Ship to
              </p>

              {addresses.length === 0 ? (
                <p className="mt-2 font-mono text-sm text-foreground-muted">
                  No saved addresses.{" "}
                  <Link href="/profile" className="text-accent hover:underline">
                    Add one in your profile
                  </Link>{" "}
                  before checking out.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {addresses.map((address) => (
                    <li key={address.id}>
                      <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border border-border px-4 py-3 text-sm text-foreground-muted has-[:checked]:border-accent has-[:checked]:text-foreground">
                        <input
                          type="radio"
                          name="address"
                          checked={selectedAddressId === address.id}
                          onChange={() => setSelectedAddressId(address.id)}
                          className="mt-1 accent-accent"
                        />
                        <span>
                          <span className="block text-foreground">
                            {address.line1}
                            {address.line2 ? `, ${address.line2}` : ""}
                          </span>
                          <span className="block">
                            {address.city}, {address.state} {address.pincode}
                          </span>
                          <span className="block">{address.phone}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-6">
              <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
                Pay with
              </p>
              <ul className="mt-2 space-y-2">
                <li>
                  <label className="flex cursor-pointer items-center justify-between rounded-[var(--radius-card)] border border-border px-4 py-3 text-sm text-foreground-muted has-[:checked]:border-accent has-[:checked]:text-foreground">
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="paymentMethod"
                        checked={paymentMethod === "CASHFREE"}
                        onChange={() => setPaymentMethod("CASHFREE")}
                        className="accent-accent"
                      />
                      Cashfree
                    </span>
                  </label>
                </li>
                <li>
                  <label className="flex cursor-pointer items-center justify-between rounded-[var(--radius-card)] border border-border px-4 py-3 text-sm text-foreground-muted has-[:checked]:border-accent has-[:checked]:text-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="paymentMethod"
                        checked={paymentMethod === "WALLET"}
                        disabled={!walletUsable}
                        onChange={() => setPaymentMethod("WALLET")}
                        className="accent-accent"
                      />
                      Wallet
                    </span>
                    <span className="font-mono text-xs">
                      ₹{wallet ? Number(wallet.balance).toFixed(2) : "—"}
                    </span>
                  </label>
                </li>
              </ul>
            </div>

            {placeError && <p className="mt-4 font-mono text-xs text-danger">{placeError}</p>}

            <button
              type="button"
              onClick={handleCheckout}
              disabled={placing || !selectedAddressId}
              className="mt-6 w-full rounded-[var(--radius-card)] border border-accent px-6 py-3 font-mono text-xs tracking-widest text-accent uppercase hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {placing ? "Placing order…" : "Place order"}
            </button>
          </section>
        </>
      )}
    </main>
  );
}
