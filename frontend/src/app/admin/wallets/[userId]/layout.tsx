import type { ReactNode } from "react";

// Client-rendered dynamic segment (fetches the wallet by userId, no static
// params) — can't produce a static shell, so opt out like the other admin
// [id] routes and the customer-facing /orders/[id].
export const instant = false;

export default function AdminWalletLayout({ children }: { children: ReactNode }) {
  return children;
}
