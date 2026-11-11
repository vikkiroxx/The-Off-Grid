"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

export function AdminHeader() {
  const { user, logout } = useAuth();
  const router = useRouter();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-4">
      <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
        {user ? `Signed in as ${user.name}` : ""}
      </p>
      <div className="flex items-center gap-4">
        <ThemeToggle />
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-[var(--radius-card)] border border-border px-4 py-2 font-mono text-xs tracking-widest text-foreground-muted uppercase outline-none hover:border-danger hover:text-danger focus-visible:ring-2 focus-visible:ring-accent"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
