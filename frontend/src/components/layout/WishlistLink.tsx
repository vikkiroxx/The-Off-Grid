"use client";

import Link from "next/link";
import { useWishlist } from "@/lib/wishlist-context";

export function WishlistLink() {
  const { items } = useWishlist();

  return (
    <Link
      href="/wishlist"
      className="relative font-mono text-xs tracking-widest text-foreground-muted uppercase hover:text-foreground"
    >
      Wishlist
      {items.length > 0 && (
        <span className="absolute -top-2.5 -right-3 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] text-black">
          {items.length}
        </span>
      )}
    </Link>
  );
}
