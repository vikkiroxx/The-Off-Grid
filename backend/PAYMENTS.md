# Payments

A provider-agnostic payment gateway integration. The checkout flow, order
model, and admin panel never talk to a gateway SDK directly — only to
`PaymentsService`, which delegates to whichever adapter `PAYMENT_PROVIDER`
selects. Swapping or adding a gateway is a new adapter file plus a factory
branch, not a rewrite of checkout or order management.

## Architecture

```
backend/src/payments/
├── types.ts                         # Provider-independent domain types
├── provider.interface.ts            # The PaymentProvider contract
├── factory.ts                       # Resolves PAYMENT_PROVIDER -> an adapter instance
├── service.ts                       # Owns the payment lifecycle (orchestration only)
├── providers/
│   └── cashfree/
│       └── cashfree.provider.ts     # The only file that imports the Cashfree SDK
└── __tests__/                       # Unit tests (mocked provider, no real DB/network)

backend/src/controllers/payment.controller.ts   # HTTP layer: checkout-pay, status, webhook, admin refund
backend/src/routes/payment.routes.ts            # /api/payments/* (customer-facing + public webhook)
backend/src/routes/order.routes.ts              # POST /api/orders/:orderId/pay (lives with the other order routes)
backend/src/routes/admin.routes.ts              # POST /api/admin/orders/:id/refund
backend/src/config/env.ts                       # Startup validation (fails fast on bad config)
```

Nothing outside `src/payments/` imports `cashfree-pg`. `order.controller.ts`,
the frontend, and the admin panel only ever see `types.ts`'s domain types
(`NormalizedPaymentStatus`, `CreatePaymentResult`, etc.) and the handful of
functions `service.ts` exports.

### Database model

A dedicated `Payment` model, not fields bolted onto `Order` — see
`prisma/schema.prisma`:

- **`Payment`** — one row per payment *attempt*. An order can accumulate
  several (the customer abandons checkout once, retries later); at most one
  is ever allowed to reach `SUCCEEDED` (enforced in `service.ts`, not just by
  the schema). Tracks `provider`, `providerOrderId` (unique per provider),
  `providerPaymentId`, `amount`, `currency`, `status`, a per-attempt
  `idempotencyKey`, and failure details.
- **`Refund`** — one row per refund request against a `Payment`, with its own
  `refundRef`/`providerRefundId`/`status`.
- **`PaymentWebhookEvent`** — a dedup record keyed on `(provider, sha256(raw
  body))`, so a retried webhook delivery is processed at most once.

`Order.status` is **unchanged** — still `PENDING | PAID | SHIPPED | DELIVERED
| CANCELLED | REFUNDED`, still what the admin panel's status dropdown and the
customer-facing tracking page use. `Payment.status` is a separate,
finer-grained enum (`PENDING | PROCESSING | SUCCEEDED | FAILED | CANCELLED |
REFUNDED | PARTIALLY_REFUNDED`) that tracks the gateway's own lifecycle.
`Order.status` only ever moves to `PAID` as a side effect of a `Payment`
reaching `SUCCEEDED` — an admin changing shipment status never touches
`Payment`, and a payment outcome never jumps the order straight to `SHIPPED`
or `DELIVERED`.

### Checkout flow

1. `POST /api/orders` — unchanged: validates the cart, computes the total
   server-side, creates the `Order` + `OrderItem`s, decrements stock, clears
   the cart (all in one transaction, exactly as before). **Immediately
   after**, it calls `startPayment()`, which creates a `Payment` row and asks
   the configured provider for a checkout session. The response includes
   `payment: { sessionId, providerOrderId }` on success, or `payment: null` +
   `paymentError` if the gateway call itself failed — the order still exists
   either way; nothing is rolled back, because stock was already reserved
   correctly.
2. Frontend calls `launchCheckout(sessionId)` (`frontend/src/lib/cashfree-checkout.ts`,
   the only frontend file that imports the Cashfree JS SDK), which redirects
   the browser to Cashfree's hosted checkout.
3. If payment initiation failed, or the customer abandons the first attempt,
   `POST /api/orders/:orderId/pay` retries. If there's still an active
   (`PENDING`/`PROCESSING`) attempt, it just refreshes that same attempt's
   session; otherwise it starts a brand-new `Payment` row. **Stock is never
   touched again** — it was already decremented once, at order creation.
4. Cashfree redirects the customer back to `FRONTEND_URL/checkout/result?order_id={order_id}`
   (`{order_id}` is Cashfree's own placeholder, substituted with our
   `Payment.providerOrderId`). That page calls `GET /api/payments/status/:providerOrderId`,
   which — note the name — **reconciles**, it doesn't just read a cached
   value: if the payment is still non-terminal, it calls the provider's live
   status API before answering. The customer never sees "paid" just because
   they landed on this URL.
5. Cashfree also POSTs a webhook to `BACKEND_PUBLIC_URL/api/payments/webhooks/cashfree`.
   Both the webhook and the reconcile endpoint funnel through the same
   `applyVerifiedResult()` in `service.ts`, so the rules below apply
   regardless of which one gets there first.

### Safety rules (`service.ts`)

- **Amount/currency are re-checked against the stored `Payment` row** before
  any status is applied — a webhook claiming success for the wrong amount is
  rejected outright, not just logged.
- **A terminal `Payment` (`SUCCEEDED`/`FAILED`/`CANCELLED`/refunded) can never
  be regressed.** An out-of-order "failed" event arriving after a "success"
  event is a no-op.
- **The `Payment → SUCCEEDED` transition is guarded with an optimistic
  `updateMany({ where: { id, status: <status we read> } })`** — if two
  concurrent calls (a webhook and a reconcile-on-redirect racing each other)
  both try to apply the same transition, only one wins; the other sees
  `count: 0` and treats it as already-applied.
- **The webhook dedup record is written only *after* the event is
  successfully applied.** If processing throws (amount mismatch, a transient
  DB error), nothing is recorded — so a provider retry of that exact delivery
  gets a genuine second attempt instead of being silently swallowed as a
  "duplicate" of a failed attempt. (This was a real bug caught during manual
  testing, not a hypothetical — see the fix history in `service.ts`.)
- **Succeeding cancels sibling attempts.** If a customer somehow has two
  payment attempts open at once and one succeeds, the other is marked
  `CANCELLED` so it can never also be applied.
- **Refunds are a separate, explicit admin action** (`POST
  /api/admin/orders/:id/refund`) — never an automatic side effect of changing
  `Order.status` to `CANCELLED`/`REFUNDED` in the existing admin dropdown.
  Amount is validated against what's actually refundable (payment amount
  minus already-refunded), supporting partial refunds
  (`Payment.status` becomes `PARTIALLY_REFUNDED` until the full amount is
  refunded). **Refunds now always pay out to the customer's wallet**, not
  back through the gateway — see "Wallet integration" below; `refundPayment()`
  no longer calls `provider.refundPayment()` at all, so that provider method
  is currently unused (kept on the interface for a future provider that might
  need it, or if this decision is revisited).

## Wallet integration

Wallet top-ups are Cashfree-funded, so they reuse the `Payment` model rather
than a parallel one — this gets the webhook dedup, optimistic
double-processing guard, and reconcile-by-`providerOrderId` machinery above
for free, instead of reimplementing it for a second async-gateway flow:

- `Payment.purpose` (`ORDER_PAYMENT | WALLET_TOPUP`) discriminates the two
  cases. `Payment.orderId` is nullable — always set for `ORDER_PAYMENT`,
  always `null` for `WALLET_TOPUP` (a top-up funds a `WalletTransaction` via
  `Payment.walletTransactionId`, not an `Order`).
- `applyVerifiedResult()`'s `SUCCEEDED` branch is scoped to `purpose ===
  "ORDER_PAYMENT"` for the `Order → PAID` update **and** the sibling-cancel
  query — this guard is load-bearing, not cosmetic: with `orderId` nullable,
  an unscoped sibling-cancel query would match (and cancel) *every other
  user's* pending top-up at once, since they all share `orderId: null`. See
  the regression test in `__tests__/service.test.ts` ("does not cancel
  another user's pending top-up when one succeeds").
- **Split wallet + gateway checkout.** `createOrder` takes `useWalletBalance:
  boolean` (not a `paymentMethod` enum). When true, it debits
  `min(wallet.balance, order.totalAmount)` from the wallet synchronously
  inside the order-creation transaction — exactly the wallet-only path below,
  just for a partial amount — and only starts a gateway `Payment` for
  whatever remains. A balance that covers the whole order skips the gateway
  leg entirely (order goes straight to `PAID`, same as before); a balance of
  zero behaves exactly like a plain gateway checkout. `startPayment()` nets
  out any existing wallet debit for the order (via a `WalletTransaction`
  aggregate on `orderId` + `type: "ORDER_PAYMENT"`) so the gateway `Payment`
  it creates is sized at the remainder, never the full total — this means an
  order can end up funded by *both* a wallet debit and a gateway `Payment`
  row simultaneously. `PaymentProvider` still has no `WALLET` value; a
  wallet-only order (remainder `<= 0`) produces zero `Payment` rows, same as
  always.
- **Refunds always land in the wallet**, and `refundPayment()` now tracks two
  independent refundable pools per order — the gateway `Payment`'s amount
  (via its `Refund` rows) and the wallet-debited amount (via
  `WalletTransaction` rows) — and draws from the gateway pool first, then the
  wallet-debit pool, for whatever single refund amount the admin requests.
  The wallet-debit pool's "already refunded" total is derived as *all*
  `REFUND`-type `WalletTransaction`s for the order minus the ones already
  accounted for by `Refund` rows, rather than its own counter, since every
  refund — from either pool — credits the wallet the same way and only the
  gateway-pool portion gets its own `Refund` row. A refund that draws from
  only the wallet-debit pool (no `Payment` row touched at all) is
  unchanged from before: no `Refund` row, the `WalletTransaction` is the
  audit record. See the "split wallet + gateway order" tests in
  `__tests__/service.test.ts` for the two-pool math worked through directly.
- Wallet balance mutations (`backend/src/wallet/service.ts`) all go through
  one guarded `UPDATE` (`WHERE balance >= amount` for debits, in the same
  statement as the increment) — the wallet analogue of the optimistic
  `Payment` status guard above, safe under concurrent debits without
  `SERIALIZABLE` isolation.

## Configuring a provider

```env
PAYMENT_PROVIDER="cashfree"

CASHFREE_ENVIRONMENT="SANDBOX"   # or "PRODUCTION"
CASHFREE_CLIENT_ID="..."
CASHFREE_CLIENT_SECRET="..."
CASHFREE_API_VERSION="2026-01-01"   # optional, defaults to this

FRONTEND_URL="http://localhost:3000"
BACKEND_PUBLIC_URL="http://localhost:5000"
```

`backend/src/config/env.ts` runs `buildPaymentProvider()` at server boot
(`server.ts`'s very first line, before `app.listen`), so a missing/unsupported
provider or missing credentials crashes immediately with a clear message
instead of surfacing as a confusing 500 on the first checkout:

```
Error: PAYMENT_PROVIDER is not set. Supported values: cashfree
Error: Unsupported PAYMENT_PROVIDER "razorpay". Supported values: cashfree
Error: CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET must both be set when PAYMENT_PROVIDER=cashfree
```

It also refuses to boot with `CASHFREE_ENVIRONMENT=PRODUCTION` unless
`BACKEND_PUBLIC_URL` is `https://` — Cashfree requires `notify_url` to be
HTTPS in production.

Frontend needs its own public env var (`NEXT_PUBLIC_` — Next.js only exposes
prefixed vars to the browser bundle), kept in sync with the backend's:

```env
# frontend/.env.local
NEXT_PUBLIC_CASHFREE_ENVIRONMENT="sandbox"
```

### Merchant account & webhook setup

1. Sign up at [merchant.cashfree.com](https://merchant.cashfree.com); sandbox
   credentials are available immediately, no approval needed.
2. Dashboard → Developers → API Keys gives you the sandbox `CASHFREE_CLIENT_ID`
   / `CASHFREE_CLIENT_SECRET`.
3. Dashboard → Webhooks → add an endpoint pointing at
   `{BACKEND_PUBLIC_URL}/api/payments/webhooks/cashfree`, subscribed to
   Payment Gateway payment events. In sandbox this can be an `http://`
   tunnel URL (see below); production requires `https://`.
4. Go live: switch `CASHFREE_ENVIRONMENT=PRODUCTION`, swap in production
   credentials, and register the webhook again against the production
   endpoint — sandbox and production are entirely separate configurations on
   Cashfree's side.

### Local webhook testing

Cashfree's servers need to reach your machine, so point a tunnel
(`ngrok http 5000`, or similar) at the backend and register *that* URL as
the webhook endpoint, with `BACKEND_PUBLIC_URL` set to the same tunnel URL so
`notify_url` sent to Cashfree matches where it can actually reach you.

To exercise the logic without a tunnel or real credentials at all (what this
implementation was actually verified against — see below), you can construct
a signed payload by hand with the same algorithm Cashfree uses:

```js
const crypto = require("crypto");
const timestamp = Math.floor(Date.now() / 1000).toString();
const body = JSON.stringify({ /* ... */ });
const signature = crypto
  .createHmac("sha256", process.env.CASHFREE_CLIENT_SECRET)
  .update(timestamp + body)
  .digest("base64");

// POST to /api/payments/webhooks/cashfree with:
//   x-webhook-signature: <signature>
//   x-webhook-timestamp: <timestamp>
//   body: <body>  (exact bytes — don't re-serialize)
```

## Migration & deployment

```bash
cd backend
npx prisma migrate deploy   # applies 20261020170239_add_payments (and any later ones)
```

No backfill is needed — the migration only adds new tables (`Payment`,
`Refund`, `PaymentWebhookEvent`) and a new relation field on `Order`; no
existing data is touched or at risk. Existing orders simply have zero
`Payment` rows until someone pays for a *new* order; historical orders are
unaffected and still render fine (the admin UI and customer tracking page
already handle `payments` being absent/empty).

## Adding another provider

1. `backend/src/payments/providers/<name>/<name>.provider.ts` — implement
   `PaymentProvider` (`createPayment`, `getPaymentStatus`, `verifyWebhook`,
   `refundPayment`), using that gateway's SDK/API internally. Map its
   status/webhook vocabulary onto `NormalizedPaymentStatus`/
   `NormalizedRefundStatus` from `types.ts` — nothing provider-specific
   should leak past this file.
2. `backend/src/payments/factory.ts` — add the name to `SUPPORTED_PROVIDERS`,
   a `build<Name>Provider()` function reading that provider's env vars, and a
   `case` in the `switch`.
3. `backend/src/controllers/payment.controller.ts` — add a route for that
   provider's webhook shape if it differs from Cashfree's (e.g.
   `POST /api/payments/webhooks/<name>`), calling the same `handleWebhook()`
   in `service.ts` (it's already provider-agnostic — it just needs the raw
   body/signature/timestamp in whatever shape that provider sends).
4. If the new provider needs client-side SDK involvement for checkout (most
   do), add an isolated `frontend/src/lib/<name>-checkout.ts` mirroring
   `cashfree-checkout.ts`, and branch on `Payment.provider` wherever the
   frontend currently assumes Cashfree's redirect flow.
5. Nothing in `order.controller.ts`, the admin panel, or the customer order
   pages needs to change — they only ever see the normalized types.

## Switching the default provider

Change `PAYMENT_PROVIDER` and redeploy — that's the entire switch for *new*
checkouts. **Existing `Payment` rows keep whatever `provider` they were
created with** (`Payment.provider` is stored per-row, not inferred from the
current env var), so:

- A payment that's still in flight when you switch providers continues to be
  verified/reconciled against the provider it was actually created with
  (`service.ts` always resolves status via `getPaymentProvider()`, which is a
  single global instance — if you need two providers live simultaneously
  during a migration window, `factory.ts`'s `cached` single-instance model
  would need to become a per-`Payment.provider` lookup instead; not
  implemented, since this project only ever configures one active provider at
  a time).
- Refunds against old payments need the *original* provider's credentials
  still configured to succeed, even after the default has moved on.

## Known limitations / what's not implemented

- **Only Cashfree is implemented.** The interface and factory are ready for a
  second adapter, but no second one exists yet.
- **No automatic order expiry.** If a customer abandons every payment
  attempt for an order, the order stays `PENDING` indefinitely — admin has to
  manually cancel it (which already correctly restocks, via the existing
  admin order logic) to release the stock. A scheduled sweep that expires
  stale pending orders would be a reasonable follow-up.
- **Refund webhooks aren't processed.** Cashfree also sends
  `REFUND_*`/`DISPUTE_*` webhook types; this implementation acknowledges them
  (200, so Cashfree stops retrying) but doesn't act on them. Refund status is
  captured at creation time from the synchronous API response only. A refund
  stuck in `PENDING` has to be checked manually via Cashfree's dashboard or a
  new `PGOrderFetchRefund` call — there's no reconcile endpoint for refunds
  yet (there is one for payments: `GET /api/payments/status/:providerOrderId`).
- **Simultaneous multi-provider support isn't implemented** — see "Switching
  the default provider" above.
- **No live payment was tested.** I do not have real Cashfree sandbox
  credentials. What *was* verified, against the real running app and a real
  Postgres database (not just type-checked):
  - The full create-order request actually reaches Cashfree's sandbox API
    (confirmed via its own `authentication Failed` response to fake
    credentials — proving the request shape, headers, and SDK wiring are
    correct) and is handled gracefully end-to-end (order still created, stock
    still decremented exactly once, clean error surfaced).
  - A hand-signed webhook (HMAC-SHA256 computed the same way Cashfree does,
    using this app's own configured secret) was sent to the real running
    server and correctly: verified its signature, transitioned `Payment` →
    `SUCCEEDED` and `Order` → `PAID`, deduplicated an identical resend,
    rejected an amount-mismatched payload, rejected a late/out-of-order
    failure event after success, and — once the ordering bug above was fixed
    — allowed a genuine retry of a failed processing attempt.
  - The refund flow end-to-end (creation, provider call, graceful failure
    handling, amount-validation) the same way.
  - 30 automated unit tests (`npm test`) cover the same rules with a mocked
    provider and an in-memory fake of the relevant Prisma calls, so they run
    without a database or network and will catch a regression without
    needing manual re-verification each time.
