"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

interface PaymentStatusResponse {
  orderId: string | null;
  providerOrderId: string;
  status: string;
  failureMessage: string | null;
}

function ResultContent() {
  const searchParams = useSearchParams();
  // Our Payment.providerOrderId — Cashfree substitutes it into the return_url's
  // {order_id} placeholder before redirecting here. Never treated as proof of
  // payment by itself; it just tells us which top-up to ask the backend about.
  const providerOrderId = searchParams.get("order_id");
  const { user, loading: authLoading } = useAuth();

  const [result, setResult] = useState<PaymentStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user || !providerOrderId) return;
    api
      .get<PaymentStatusResponse>(`/payments/status/${providerOrderId}`)
      .then(setResult)
      .catch((err) => setError((err as Error).message));
  }, [authLoading, user, providerOrderId]);

  if (!providerOrderId) {
    return <p className="font-mono text-sm text-danger">Missing top-up reference.</p>;
  }

  if (authLoading || (!result && !error)) {
    return (
      <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
        Confirming your top-up…
      </p>
    );
  }

  if (error) {
    return <p className="font-mono text-sm text-danger">{error}</p>;
  }

  const status = result!.status;
  const isSuccess = status === "SUCCEEDED";
  const isTerminalFailure = status === "FAILED" || status === "CANCELLED";

  return (
    <div className="space-y-6 text-center">
      <p
        className={`font-mono text-sm ${
          isSuccess ? "text-accent" : isTerminalFailure ? "text-danger" : "text-foreground-muted"
        }`}
      >
        {isSuccess
          ? "Top-up successful!"
          : isTerminalFailure
            ? "Top-up failed or was cancelled."
            : "Top-up is still processing — check back shortly."}
      </p>
      {result!.failureMessage && (
        <p className="font-mono text-xs text-foreground-muted">{result!.failureMessage}</p>
      )}
      <Link
        href="/wallet"
        className="inline-block rounded-[var(--radius-card)] border border-accent px-6 py-3 font-mono text-xs tracking-widest text-accent uppercase hover:bg-accent-soft"
      >
        Back to wallet
      </Link>
    </div>
  );
}

export default function WalletResultPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <Suspense
        fallback={
          <p className="font-mono text-xs tracking-widest text-foreground-muted uppercase">
            Loading…
          </p>
        }
      >
        <ResultContent />
      </Suspense>
    </main>
  );
}
