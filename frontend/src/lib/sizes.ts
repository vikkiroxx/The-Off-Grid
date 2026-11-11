import { api } from "@/lib/api";
import { Audience } from "@/types";

export async function getProductSizes(params: {
  audience?: Audience;
  category?: string;
  search?: string;
}): Promise<string[]> {
  const q = new URLSearchParams();
  if (params.audience) q.set("audience", params.audience);
  if (params.category) q.set("category", params.category);
  if (params.search) q.set("search", params.search);
  const query = q.toString();

  try {
    return await api.get<string[]>(`/products/sizes${query ? `?${query}` : ""}`);
  } catch {
    return [];
  }
}
