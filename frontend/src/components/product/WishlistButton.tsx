"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useWishlist } from "@/lib/wishlist-context";

export function WishlistButton({ productId }: { productId: string }) {
  const { user } = useAuth();
  const { isWishlisted, toggle } = useWishlist();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const wishlisted = isWishlisted(productId);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!user) {
      router.push("/login");
      return;
    }

    setPending(true);
    try {
      await toggle(productId);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
      aria-pressed={wishlisted}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/80 backdrop-blur disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg
        viewBox="0 0 24 24"
        className={`h-4 w-4 ${wishlisted ? "fill-accent text-accent" : "fill-none text-foreground-muted"}`}
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 20.25c-.3 0-.6-.1-.84-.3C8.4 17.8 3 13.3 3 8.9 3 5.9 5.3 3.75 8 3.75c1.6 0 3.1.8 4 2.1.9-1.3 2.4-2.1 4-2.1 2.7 0 5 2.15 5 5.15 0 4.4-5.4 8.9-8.16 11.05-.24.2-.54.3-.84.3Z"
        />
      </svg>
    </button>
  );
}
