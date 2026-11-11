"use client";

import Link from "next/link";
import { CSSProperties } from "react";
import { Product } from "@/types";
import { getProductBadge } from "@/lib/product-helpers";
import { Badge } from "@/components/ui/Badge";
import { WishlistButton } from "@/components/product/WishlistButton";
import { QuickAddButton } from "@/components/product/QuickAddButton";
import { useCart } from "@/lib/cart-context";

export function ProductCard({ product }: { product: Product }) {
  const { items } = useCart();
  const badge = getProductBadge(product);
  const [primary, hover] = product.images;

  const defaultVariant = product.variants.find((v) => v.stock > 0);
  const inCart = defaultVariant
    ? items.some((item) => item.variant.id === defaultVariant.id)
    : false;

  // Flips the shared hover-glow/corner-bracket hue from Hyper Neon to
  // Electric Sun once this product's default variant is already in the cart.
  const glowStyle = inCart
    ? ({
        "--card-glow": "var(--color-accent-2)",
        "--card-glow-soft": "var(--color-accent-2-soft)",
      } as CSSProperties)
    : undefined;

  return (
    <Link
      href={`/products/${product.slug}`}
      style={glowStyle}
      className="group corner-brackets card-hover-glow block overflow-hidden rounded-[var(--radius-card)] border border-border bg-background-elevated"
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-background">
        {primary && (
          <img
            src={primary}
            alt={product.name}
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300 group-hover:opacity-0"
          />
        )}
        {hover && (
          <img
            src={hover}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          />
        )}
        {badge && (
          <div className="absolute top-2 left-2">
            <Badge label={badge} />
          </div>
        )}
        <div className="absolute top-2 right-2 flex flex-col gap-2">
          <WishlistButton productId={product.id} />
          <QuickAddButton variants={product.variants} />
        </div>
      </div>

      <div className="space-y-1 p-3">
        <p className="truncate text-sm font-medium tracking-wide text-foreground uppercase">
          {product.name}
        </p>
        <p className="font-mono text-sm text-foreground-muted">₹{product.price}</p>
      </div>
    </Link>
  );
}
