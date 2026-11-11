"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { WishlistItem } from "@/types";

interface WishlistContextValue {
  items: WishlistItem[];
  loading: boolean;
  isWishlisted: (productId: string) => boolean;
  toggle: (productId: string) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setItems(await api.get<WishlistItem[]>("/wishlist"));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    // Re-sync whenever login state changes (log in, log out, switch account).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  function isWishlisted(productId: string) {
    return items.some((item) => item.productId === productId);
  }

  async function removeItem(itemId: string) {
    await api.delete(`/wishlist/${itemId}`);
    await refresh();
  }

  async function toggle(productId: string) {
    const existing = items.find((item) => item.productId === productId);
    if (existing) {
      await removeItem(existing.id);
      return;
    }
    await api.post<WishlistItem>("/wishlist", { productId });
    await refresh();
  }

  return (
    <WishlistContext.Provider value={{ items, loading, isWishlisted, toggle, removeItem, refresh }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used within WishlistProvider");
  return ctx;
}
