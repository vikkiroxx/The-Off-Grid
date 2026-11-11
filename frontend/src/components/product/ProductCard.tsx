import Link from "next/link";
import { Product } from "@/types";
import { getProductBadge } from "@/lib/product-helpers";
import { Badge } from "@/components/ui/Badge";
import { WishlistButton } from "@/components/product/WishlistButton";

export function ProductCard({ product }: { product: Product }) {
  const badge = getProductBadge(product);
  const [primary, hover] = product.images;

  return (
    <Link
      href={`/products/${product.slug}`}
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
        <div className="absolute top-2 right-2">
          <WishlistButton productId={product.id} />
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
