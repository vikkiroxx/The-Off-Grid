"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useCart } from "@/lib/cart-context";
import { Variant } from "@/types";

// Quick-add always targets the first in-stock variant — the tile has no room
// to pick a size, so the customer refines size/color later on the cart page.
export function QuickAddButton({ variants }: { variants: Variant[] }) {
  const { user } = useAuth();
  const { items, addToCart, removeItem } = useCart();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const defaultVariant = variants.find((v) => v.stock > 0);
  const cartItem = defaultVariant
    ? items.find((item) => item.variant.id === defaultVariant.id)
    : undefined;

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!user) {
      router.push("/login");
      return;
    }
    if (!defaultVariant) return;

    setPending(true);
    try {
      if (cartItem) {
        await removeItem(cartItem.id);
      } else {
        await addToCart(defaultVariant.id, 1);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending || !defaultVariant}
      aria-label={cartItem ? "Remove from cart" : "Add to cart"}
      aria-pressed={Boolean(cartItem)}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/80 backdrop-blur disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg
        viewBox="0 0 24 24"
        className={`h-4 w-4 ${cartItem ? "fill-accent-2 text-accent-2" : "fill-none text-foreground-muted"}`}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
    </button>
  );
}
