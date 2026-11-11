"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart-context";

export function CartLink() {
  const { count } = useCart();

  return (
    <Link
      href="/cart"
      aria-label="Cart"
      className="relative flex items-center text-foreground-muted hover:text-foreground"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
      {count > 0 && (
        <span className="absolute -top-2 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-2 px-1 font-mono text-[10px] text-on-accent-2">
          {count}
        </span>
      )}
    </Link>
  );
}
