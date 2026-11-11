"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { reverseGeocode } from "@/lib/geocode";
import { STATUS_STYLES } from "@/lib/order-helpers";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { PickedLocation } from "@/components/profile/MapPicker";
import { Address, Order, Wallet } from "@/types";

// Leaflet touches `window` at import time, so it can only load on the client.
const MapPicker = dynamic(
  () => import("@/components/profile/MapPicker").then((m) => m.MapPicker),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[280px] items-center justify-center rounded-[var(--radius-card)] border border-border bg-background-elevated">
        <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
          Loading map…
        </p>
      </div>
    ),
  },
);

const EMPTY_ADDRESS_FORM = {
  line1: "",
  line2: "",
  city: "",
  state: "",
  pincode: "",
  phone: "",
};

export default function ProfilePage() {
  const { user, loading, logout, refresh } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);

  const [addingAddress, setAddingAddress] = useState(false);
  const [addressForm, setAddressForm] = useState(EMPTY_ADDRESS_FORM);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [savingAddress, setSavingAddress] = useState(false);
  const [removingAddressId, setRemovingAddressId] = useState<string | null>(null);

  const [showMap, setShowMap] = useState(false);
  const [pickedLocation, setPickedLocation] = useState<PickedLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const locateRequestId = useRef(0);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    // Seed the editable fields from the loaded account, and fetch the full
    // profile (addresses) once per logged-in user rather than on every render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(user.name);
    setEmail(user.email);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    api
      .get<Order[]>("/orders")
      .then(setOrders)
      .catch(() => setOrders([]));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api
      .get<Wallet>("/wallet")
      .then(setWallet)
      .catch(() => setWallet(null));
  }, [user]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await api.patch("/users/me", { name, email });
      await refresh();
      setSaved(true);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function resetAddressForm() {
    setAddingAddress(false);
    setAddressError(null);
    setAddressForm(EMPTY_ADDRESS_FORM);
    setShowMap(false);
    setPickedLocation(null);
    setLocateError(null);
  }

  async function handleAddAddress(e: FormEvent) {
    e.preventDefault();
    setSavingAddress(true);
    setAddressError(null);
    try {
      await api.post<Address>("/users/me/addresses", {
        ...addressForm,
        line2: addressForm.line2 || undefined,
      });
      await refresh();
      resetAddressForm();
    } catch (err) {
      setAddressError((err as Error).message);
    } finally {
      setSavingAddress(false);
    }
  }

  async function handlePickLocation(loc: PickedLocation) {
    setPickedLocation(loc);
    setLocateError(null);

    const requestId = ++locateRequestId.current;
    setLocating(true);
    try {
      const fields = await reverseGeocode(loc.lat, loc.lng);
      if (requestId !== locateRequestId.current) return; // a newer click superseded this one

      setAddressForm((f) => ({
        ...f,
        line1: fields.line1 || f.line1,
        city: fields.city || f.city,
        state: fields.state || f.state,
        pincode: fields.pincode || f.pincode,
      }));
    } catch (err) {
      if (requestId === locateRequestId.current) {
        setLocateError((err as Error).message);
      }
    } finally {
      if (requestId === locateRequestId.current) {
        setLocating(false);
      }
    }
  }

  async function handleRemoveAddress(id: string) {
    setRemovingAddressId(id);
    try {
      await api.delete(`/users/me/addresses/${id}`);
      await refresh();
    } catch {
      // Best-effort — the address list simply won't update if this fails.
    } finally {
      setRemovingAddressId(null);
    }
  }

  if (loading || !user) {
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
        <p className="font-mono text-xs tracking-widest text-accent uppercase">Account</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {user.name}
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">{user.email}</p>
        <button
          type="button"
          onClick={() => {
            logout();
            router.push("/");
          }}
          className="mt-8 rounded-[var(--radius-card)] border border-border px-6 py-3 font-mono text-xs tracking-widest text-foreground-muted uppercase hover:border-danger hover:text-danger"
        >
          Log out
        </button>
      </section>

      <section>
        <SectionHeading eyebrow="Settings" title="Account Details" />
        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <label
              htmlFor="name"
              className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
            >
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>

          {saveError && <p className="font-mono text-xs text-danger">{saveError}</p>}
          {saved && !saveError && (
            <p className="font-mono text-xs text-accent uppercase tracking-widest">Saved</p>
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

      <section>
        <SectionHeading eyebrow="Store Credit" title="Wallet" viewAllHref="/wallet" />
        <div className="flex items-center justify-between rounded-[var(--radius-card)] border border-border px-5 py-4">
          <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
            Balance
          </p>
          <p className="font-mono text-lg text-foreground">
            ₹{wallet ? Number(wallet.balance).toFixed(2) : "—"}
          </p>
        </div>
      </section>

      <section>
        <SectionHeading eyebrow="Addresses on file" title="Shipping Addresses" />

        {user.addresses && user.addresses.length > 0 ? (
          <ul className="space-y-3">
            {user.addresses.map((address) => (
              <li
                key={address.id}
                className="flex items-start justify-between gap-4 rounded-[var(--radius-card)] border border-border px-5 py-4 text-sm text-foreground-muted"
              >
                <div>
                  <p className="text-foreground">
                    {address.line1}
                    {address.line2 ? `, ${address.line2}` : ""}
                  </p>
                  <p>
                    {address.city}, {address.state} {address.pincode}
                  </p>
                  <p>{address.phone}</p>
                  {address.isDefault && (
                    <p className="mt-1 font-mono text-[10px] tracking-widest text-accent uppercase">
                      Default
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveAddress(address.id)}
                  disabled={removingAddressId === address.id}
                  className="font-mono text-[10px] tracking-widest text-foreground-muted uppercase hover:text-danger disabled:opacity-50"
                >
                  {removingAddressId === address.id ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-5 font-mono text-sm text-foreground-muted">No addresses on file yet.</p>
        )}

        {addingAddress ? (
          <form onSubmit={handleAddAddress} className="mt-5 space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
                  Find on map
                </p>
                <button
                  type="button"
                  onClick={() => setShowMap((v) => !v)}
                  className="font-mono text-[10px] tracking-widest text-accent uppercase hover:underline"
                >
                  {showMap ? "Hide map" : "Pick location"}
                </button>
              </div>

              {showMap && (
                <div className="mt-2 space-y-2">
                  <MapPicker marker={pickedLocation} onPick={handlePickLocation} />
                  <p className="font-mono text-[11px] text-foreground-muted">
                    {locating
                      ? "Looking up address…"
                      : pickedLocation
                        ? "Fields below filled from the pin — adjust anything that's off."
                        : "Click the map to drop a pin and fill in the fields below."}
                  </p>
                  {locateError && <p className="font-mono text-xs text-danger">{locateError}</p>}
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="line1"
                className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
              >
                Address line 1
              </label>
              <input
                id="line1"
                type="text"
                required
                value={addressForm.line1}
                onChange={(e) => setAddressForm((f) => ({ ...f, line1: e.target.value }))}
                className="mt-2 w-full rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
              />
            </div>

            <div>
              <label
                htmlFor="line2"
                className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
              >
                Address line 2 (optional)
              </label>
              <input
                id="line2"
                type="text"
                value={addressForm.line2}
                onChange={(e) => setAddressForm((f) => ({ ...f, line2: e.target.value }))}
                className="mt-2 w-full rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="city"
                  className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
                >
                  City
                </label>
                <input
                  id="city"
                  type="text"
                  required
                  value={addressForm.city}
                  onChange={(e) => setAddressForm((f) => ({ ...f, city: e.target.value }))}
                  className="mt-2 w-full rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
                />
              </div>

              <div>
                <label
                  htmlFor="state"
                  className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
                >
                  State
                </label>
                <input
                  id="state"
                  type="text"
                  required
                  value={addressForm.state}
                  onChange={(e) => setAddressForm((f) => ({ ...f, state: e.target.value }))}
                  className="mt-2 w-full rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="pincode"
                  className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
                >
                  Pincode
                </label>
                <input
                  id="pincode"
                  type="text"
                  required
                  value={addressForm.pincode}
                  onChange={(e) => setAddressForm((f) => ({ ...f, pincode: e.target.value }))}
                  className="mt-2 w-full rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
                />
              </div>

              <div>
                <label
                  htmlFor="phone"
                  className="font-mono text-xs tracking-widest text-foreground-muted uppercase"
                >
                  Phone number
                </label>
                <input
                  id="phone"
                  type="tel"
                  required
                  value={addressForm.phone}
                  onChange={(e) => setAddressForm((f) => ({ ...f, phone: e.target.value }))}
                  className="mt-2 w-full rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
                />
              </div>
            </div>

            {addressError && <p className="font-mono text-xs text-danger">{addressError}</p>}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={savingAddress}
                className="rounded-[var(--radius-card)] border border-accent px-6 py-3 font-mono text-xs tracking-widest text-accent uppercase hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingAddress ? "Saving…" : "Save address"}
              </button>
              <button
                type="button"
                onClick={resetAddressForm}
                className="rounded-[var(--radius-card)] border border-border px-6 py-3 font-mono text-xs tracking-widest text-foreground-muted uppercase hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAddingAddress(true)}
            className="mt-2 rounded-[var(--radius-card)] border border-border px-6 py-3 font-mono text-xs tracking-widest text-foreground-muted uppercase hover:border-accent hover:text-accent"
          >
            + Add address
          </button>
        )}
      </section>

      <section>
        <SectionHeading eyebrow="Order History" title="Your Orders" viewAllHref="/products" />
        {orders === null ? (
          <p className="font-mono text-sm text-foreground-muted">Loading orders…</p>
        ) : orders.length === 0 ? (
          <p className="font-mono text-sm text-foreground-muted">
            No orders yet. Your drops will show up here.
          </p>
        ) : (
          <ul className="space-y-3">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/orders/${order.id}`}
                  className="card-hover-glow flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border px-5 py-4"
                >
                  <div>
                    <p className="font-mono text-xs text-foreground-muted">
                      #{order.id.slice(0, 8)} · {new Date(order.createdAt).toLocaleDateString()}
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {order.items.length} item{order.items.length === 1 ? "" : "s"} · ₹
                      {order.totalAmount}
                    </p>
                  </div>
                  <span
                    className={`inline-block rounded-[var(--radius-card)] border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase ${
                      STATUS_STYLES[order.status] ?? "border-border text-foreground-muted"
                    }`}
                  >
                    {order.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
