import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { Product } from "@/types";
import { getProductBadge } from "@/lib/product-helpers";
import { Badge } from "@/components/ui/Badge";
import { AddToCart } from "@/components/product/AddToCart";
import { WishlistButton } from "@/components/product/WishlistButton";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// Product data (price/stock) is per-request, not known at build time — render on demand.
export const instant = false;

async function getProduct(slug: string): Promise<Product | null> {
  try {
    return await api.get<Product>(`/products/${slug}`);
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);

  if (!product) {
    return { title: "Product not found" };
  }

  const url = `${siteUrl}/products/${product.slug}`;
  const image = product.images?.[0];

  return {
    title: product.name,
    description: product.description,
    alternates: { canonical: url },
    openGraph: {
      title: product.name,
      description: product.description,
      url,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: product.name,
      description: product.description,
      images: image ? [image] : undefined,
    },
  };
}

async function ProductDetail({ slug }: { slug: string }) {
  const product = await getProduct(slug);

  if (!product) {
    notFound();
  }

  const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.images,
    sku: product.variants[0]?.sku,
    category: product.category.name,
    offers: {
      "@type": "Offer",
      url: `${siteUrl}/products/${product.slug}`,
      priceCurrency: "INR",
      price: product.price,
      availability:
        totalStock > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
    },
  };

  const badge = getProductBadge(product);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-10 sm:grid-cols-2">
        <div className="space-y-3">
          {product.images.map((image, i) => (
            <div
              key={image}
              className="aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] border border-border bg-background-elevated"
            >
              <img
                src={image}
                alt={i === 0 ? product.name : ""}
                aria-hidden={i !== 0}
                className="h-full w-full object-cover"
              />
            </div>
          ))}
        </div>

        <div>
          <p className="font-mono text-xs tracking-widest text-accent uppercase">
            {product.category.name}
          </p>
          <div className="mt-2 flex items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {product.name}
            </h1>
            <WishlistButton productId={product.id} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <p className="font-mono text-lg text-foreground">₹{product.price}</p>
            {badge && <Badge label={badge} />}
          </div>
          <p className="mt-4 text-sm text-foreground-muted">{product.description}</p>

          <AddToCart product={product} />
        </div>
      </div>
    </>
  );
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <main className="min-h-screen">
      <Suspense fallback={<p className="px-6 py-10 font-mono text-sm text-foreground-muted">Loading…</p>}>
        <ProductDetail slug={slug} />
      </Suspense>
    </main>
  );
}
