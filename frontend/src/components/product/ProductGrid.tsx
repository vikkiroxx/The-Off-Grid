import { api } from "@/lib/api";
import { Audience, Product } from "@/types";
import { ProductCard } from "@/components/product/ProductCard";

interface ProductGridProps {
  category?: string;
  audience?: Audience;
  search?: string;
  size?: string[];
  limit?: number;
}

async function getProducts({
  category,
  audience,
  search,
  size,
  limit,
}: ProductGridProps): Promise<Product[]> {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (audience) params.set("audience", audience);
  if (search) params.set("search", search);
  if (size?.length) params.set("size", size.join(","));
  if (limit) params.set("limit", String(limit));
  const query = params.toString();

  try {
    return await api.get<Product[]>(`/products${query ? `?${query}` : ""}`);
  } catch {
    return [];
  }
}

export async function ProductGrid({ category, audience, search, size, limit }: ProductGridProps) {
  const products = await getProducts({ category, audience, search, size, limit });

  if (products.length === 0) {
    return (
      <p className="font-mono text-sm text-foreground-muted">
        No products found{search ? ` for "${search}"` : category ? " in this category" : ""}.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
