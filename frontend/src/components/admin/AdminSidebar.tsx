"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", exact: true },
  { href: "/admin/products", label: "Products", exact: false },
  { href: "/admin/categories", label: "Categories", exact: false },
  { href: "/admin/orders", label: "Orders", exact: false },
  { href: "/admin/wallets", label: "Wallets", exact: false },
  { href: "/admin/messages", label: "Messages", exact: false },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin navigation"
      className="flex shrink-0 flex-col gap-1 border-b border-border p-4 sm:w-56 sm:border-r sm:border-b-0"
    >
      <Link href="/" className="mb-4 text-sm font-bold tracking-widest text-foreground uppercase">
        Clothing<span className="text-accent">{"//"}</span>Store
      </Link>
      <p className="mb-2 font-mono text-[10px] tracking-widest text-foreground-muted uppercase">
        Admin
      </p>

      {NAV_ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname?.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-[var(--radius-card)] px-3 py-2 font-mono text-xs tracking-widest uppercase outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active ? "bg-accent-soft text-accent" : "text-foreground-muted hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
