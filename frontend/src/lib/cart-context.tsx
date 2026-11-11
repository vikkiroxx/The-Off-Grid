"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CartItem } from "@/types";

interface CartContextValue {
  items: CartItem[];
  count: number;
  loading: boolean;
  addToCart: (variantId: string, quantity?: number) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  changeVariant: (itemId: string, variantId: string) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setItems(await api.get<CartItem[]>("/cart"));
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

  async function addToCart(variantId: string, quantity = 1) {
    await api.post<CartItem>("/cart", { variantId, quantity });
    await refresh();
  }

  async function updateQuantity(itemId: string, quantity: number) {
    await api.patch<CartItem>(`/cart/${itemId}`, { quantity });
    await refresh();
  }

  async function changeVariant(itemId: string, variantId: string) {
    await api.patch<CartItem>(`/cart/${itemId}`, { variantId });
    await refresh();
  }

  async function removeItem(itemId: string) {
    await api.delete(`/cart/${itemId}`);
    await refresh();
  }

  const count = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <CartContext.Provider
      value={{ items, count, loading, addToCart, updateQuantity, changeVariant, removeItem, refresh }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
