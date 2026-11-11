"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useWishlist } from "@/lib/wishlist-context";
import { ProductCard } from "@/components/product/ProductCard";

export default function WishlistPage() {
  const { user, loading: authLoading } = useAuth();
  const { items, loading: wishlistLoading } = useWishlist();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

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
    <main className="mx-auto max-w-6xl space-y-12 px-6 py-10">
      <div>
        <p className="font-mono text-xs tracking-widest text-accent uppercase">Wishlist</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Saved for Later
        </h1>
      </div>

      {wishlistLoading ? (
        <p className="font-mono text-sm text-foreground-muted">Loading wishlist…</p>
      ) : items.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-border px-8 py-16 text-center">
          <p className="font-mono text-sm text-foreground-muted">Your wishlist is empty.</p>
          <Link
            href="/products"
            className="mt-6 inline-block rounded-[var(--radius-card)] border border-accent px-6 py-3 font-mono text-xs tracking-widest text-accent uppercase hover:bg-accent-soft"
          >
            Browse products
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <ProductCard key={item.id} product={item.product} />
          ))}
        </div>
      )}
    </main>
  );
}
