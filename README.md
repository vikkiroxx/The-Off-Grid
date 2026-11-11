# The Off-Grid

E-commerce storefront (catalog, cart, orders) — Next.js frontend, Express/Prisma backend, single PostgreSQL database.

## Tech Stack

### Frontend — `frontend/`
- **Next.js** (App Router) — SSR/SSG for product pages, SEO, fast loads
- **TypeScript**
- **Tailwind CSS** — styling

### Backend — `backend/`
- **Node.js + Express** — REST API
- **TypeScript**
- **Prisma** (pinned to `6.19.3`, not the `8.0.0-rc` the CLI defaults to — v7+ dropped the classic `datasource url` schema syntax used here) — ORM, migrations, type-safe queries
- **PostgreSQL** driver via `@prisma/client`
- **JWT (`jsonwebtoken`) + `bcryptjs`** — auth
- **Zod** — request validation
- **Helmet, CORS, Morgan** — security headers, cross-origin access, request logging

### Database
- **PostgreSQL** (single database — no Mongo/SQL split)
  - Catalog flexibility (variant attributes, sizes, colors) handled via a `JSONB` column rather than a separate document store
  - Orders/inventory use relational tables with a single DB transaction per checkout (atomic stock decrement), avoiding the eventual-consistency and dual-write complexity a second database would add

## Getting started

### 1. Start PostgreSQL

Using Docker (from the repo root):

```bash
docker compose up -d
```

Or point `backend/.env`'s `DATABASE_URL` at your own existing Postgres instance.

> If you already have a native Postgres service running locally, it will likely be bound to port 5432 and the Docker container won't be reachable on that port. Either stop the native service first, or skip Docker and point `DATABASE_URL` at your native instance instead.

### 2. Backend

```bash
cd backend
npm install
npx prisma migrate dev --name init
npm run prisma:generate
npx prisma db seed
npm run dev
```

Backend runs on `http://localhost:5000`. Health check: `GET /health`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:3000`.

## Project structure

```
backend/
  prisma/schema.prisma   # Product, Variant, Category, User, Cart, Order models
  src/
    controllers/         # Request handlers
    routes/               # Express routers
    middleware/           # Auth (JWT), error handling
    server.ts             # App entry point

frontend/
  src/
    app/                  # Next.js App Router pages
    lib/api.ts            # Fetch wrapper for backend API
    types/                 # Shared TS types mirroring the Prisma models
```

## Notes

- Orders decrement variant stock inside a single Postgres transaction (`order.controller.ts`) to avoid overselling under concurrent checkouts.
- Product/variant data uses JSONB (`attributes` field) for flexible catalog metadata, avoiding the need for a second database.
- Payments — provider-agnostic gateway integration (currently Cashfree), checkout/webhook/refund flow, and how to add another provider: see [`backend/PAYMENTS.md`](backend/PAYMENTS.md).
- Wallet — per-user stored balance (`/wallet`): top up via Cashfree, pay orders entirely from the balance, admin credit/debit (`/admin/wallets`). Admin refunds now credit the wallet instead of calling the gateway's refund API — see the "Wallet integration" section of `backend/PAYMENTS.md`.
