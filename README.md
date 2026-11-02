# Qred card dashboard API

A Node.js + TypeScript API for the mobile card dashboard in the case's Appendix 1. It covers the company switcher, the due invoice, the card and its activation, "remaining spend", the latest transactions with "54 more items", and support contacts.

Task 1 (frontend/backend collaboration) is [below](#task-1-this-repository-is-the-workflow): this repository applies it.

It is built **contract-first**. [`contract/openapi.yaml`](contract/openapi.yaml) was written and reviewed before any code. The frontend can build against a mock of it from day one. The backend reads it at runtime, and every test checks responses against it.

```
Contract (OpenAPI 3.1)  ──►  Mock server (Prism)     frontend starts on day 1
        │
        ├──►  TypeScript types (generated)           the build fails if code and contract disagree
        ├──►  Fastify routes + validation            URLs, params and response schemas read from the YAML
        └──►  Contract checks in every API test      strict: no undeclared status, field or content type
```

## Quick start

Requires **Node 24 or later** (tested on 24 and 26) and **pnpm 11** (`npm install -g pnpm@11`; the exact version is pinned in `package.json`). No Docker and no database to install: Postgres runs in-process (PGlite).

```bash
pnpm install
```

```bash
pnpm start
```

The API runs on <http://localhost:8080>, with interactive docs on <http://localhost:8080/docs>. `pnpm start` turns on **demo mode**: three demo users and a fresh seeded database at every start, so restarting resets the demo (an activated card goes back to inactive).

```bash
curl -s -H "Authorization: Bearer anna" localhost:8080/v1/companies/3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b/dashboard | jq
```

| Token | Who | Shows |
|---|---|---|
| `anna` | Owner of Company AB, active card | The mockup: 5 400 / 10 000 kr, 3 latest of 57 transactions, an invoice due |
| `bob` | Cardholder at Company AB, new card | "Activate card", no invoice (cardholders don't see it), empty transactions |
| `carl` | Owner of another company | Gets a 404 on Company AB, identical to a company that doesn't exist |

Other commands:

| Command | What it does |
|---|---|
| `pnpm check` | Contract lint + type check + all tests. What CI would run |
| `pnpm test` | 48 tests, usually 10–20 s (under 30 s) |
| `pnpm mock` | The contract's mock on `:4010`, no backend needed (`Prefer: example=newCustomer` for the empty states) |
| `pnpm dev` | Like `start`, restarting on file changes |
| `pnpm contract:types` | Regenerate `src/contract/types.ts` after a contract change |
| `pnpm db:generate` | Generate a migration after a schema change |

## The API

All under `/v1`, all with `Authorization: Bearer <token>`. Money is always `{ minorUnits, currency }` (öre + ISO 4217). Errors are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details with a stable `code` the app can switch on.

| Endpoint | Mockup element |
|---|---|
| `GET /companies` | "Company AB ▾" (the switcher) |
| `GET /companies/{companyId}/dashboard` | The whole screen in **one request**: invoice, card, spending, 3 latest transactions + total, support |
| `GET /companies/{companyId}/cards/{cardId}/transactions?limit&cursor` | "54 more items in transaction view ›", cursor-paginated |
| `POST /companies/{companyId}/cards/{cardId}/activate` | "Activate card" — safe to retry |

A response from the real API. The demo data is generated relative to **today**, so your dates will differ: transactions fall in the current month and the invoice is due 14 days after you start the server.

<details>
<summary><code>GET /v1/companies/{companyId}/dashboard</code> as Anna</summary>

```json
{
  "company": { "id": "3f1c2a9e-…", "name": "Company AB", "organisationNumber": "556677-8899" },
  "dueInvoice": { "id": "9b8a7c6d-…", "amount": { "minorUnits": 125000, "currency": "SEK" }, "dueDate": "2026-11-15", "status": "due" },
  "card": {
    "id": "1a2b3c4d-…", "last4": "4242", "holderName": "Anna Andersson", "expiryMonth": 9, "expiryYear": 2029,
    "status": "active", "imageUrl": "https://cdn.qred.example/cards/standard.png", "availableActions": []
  },
  "spending": {
    "limit": { "minorUnits": 1000000, "currency": "SEK" },
    "spent": { "minorUnits": 460000, "currency": "SEK" },
    "remaining": { "minorUnits": 540000, "currency": "SEK" },
    "period": "monthly"
  },
  "latestTransactions": {
    "items": [
      { "id": "e0000000-…-0006", "merchantName": "Clas Ohlson", "category": "office_supplies", "amount": { "minorUnits": 34900, "currency": "SEK" }, "type": "purchase", "status": "settled", "occurredAt": "2026-11-01T15:06:42.366Z" },
      { "id": "e0000000-…-0005", "merchantName": "SJ AB", "category": "travel", "amount": { "minorUnits": 89500, "currency": "SEK" }, "type": "purchase", "status": "pending", "occurredAt": "2026-11-01T12:25:35.305Z" },
      { "id": "e0000000-…-0004", "merchantName": "Adobe", "category": "software", "amount": { "minorUnits": 29900, "currency": "SEK" }, "type": "refund", "status": "settled", "occurredAt": "2026-11-01T09:44:28.244Z" }
    ],
    "totalCount": 57
  },
  "support": { "phone": "+46 8 123 456 78", "email": "support@qred.example", "chatUrl": "https://qred.example/support/chat" }
}
```

"54 more items" is `totalCount − items.length`. The app shows "Activate card" only when `card.availableActions` contains `"activate"`, so the rule lives in one place.
</details>

## Database

PostgreSQL schema with Drizzle ([`src/db/schema.ts`](src/db/schema.ts), migration in [`src/db/migrations/`](src/db/migrations/)):

```
users ──< company_memberships >── companies ──< invoices
                (role)
                  │
                  └──< cards ──< transactions
              (holder must be a member of the card's company)
```

- **Facts are stored, derived values are computed.** "Spent" is this month's purchases minus refunds, settled and pending (declined excluded), floored at 0. "Remaining", `expired` and `overdue` are computed from dates, never stored, so they can't go stale.
- **Money is `bigint` minor units**, never floats.
- **Postgres enforces what it can.** Two composite foreign keys: a card's holder must be a member of the card's company, and a transaction's currency must match its card's. Checks keep limits ≥ 0 and expiry months valid.
- **The month starts at midnight in Stockholm**, not in UTC.
- **Indexes follow the queries**: `transactions (card_id, occurred_at desc, id desc)` serves both the dashboard preview and the pagination.

## Code structure

```
src/
  server.ts             startup: config checks, database, logging, shutdown
  app.ts                buildApp(): plugins, error handlers, /health, /docs, routes
  auth.ts               bearer token → user id (verifier injected, fails closed)
  routes.ts             the 4 operations, each wired from the contract by operationId
  contract/openapi.ts   reads the YAML: routes, validation, response schemas
  services.ts           use cases and access checks (membership, own card)
  repositories.ts       all SQL
  domain/rules.ts       pure business rules: spending, expiry, invoice status, who sees what
  serializers.ts        database rows → contract shapes
  errors.ts             every error → RFC 9457 Problem
test/
  api.test.ts           real HTTP + real Postgres, frozen clock
  contract.ts           strict contract check run on every response
  startup.test.ts       the real server refuses to start when misconfigured
```

Each layer only knows its neighbour. Moving from PGlite to a hosted Postgres means changing the driver in `db/client.ts`; the SQL stays the same. A new business rule from the PM touches only `rules.ts`.

## Key decisions

| Decision | Why |
|---|---|
| **A hand-written OpenAPI file**, not one generated from code | It's the document frontend and backend agree on **before** code exists, and it's language-neutral (iOS, Android, web) |
| **One dashboard endpoint** | One round trip on a mobile network, and the screen can't show half-loaded data |
| **Transactions per card**, not per company | The screen says "**your** limit": a company-wide list would show colleagues' purchases |
| **404 for "not yours"**, same as "doesn't exist" | A 403 would confirm the company or card exists |
| **Idempotent activation** (already active → 200, blocked/frozen/expired → 409) | On a mobile network the response can be lost after the server succeeded; the retry must not show an error |
| **Cursor pagination** on `(occurred_at, id)` | Stable while new transactions arrive; a tampered cursor is a 400, never a 500 |
| **`availableActions` on the card** | The backend decides what the user can do; the app doesn't re-implement the rules |
| **Explicit `null`s for empty states** | A new customer has no card or invoice yet; the app gets a defined shape, not missing keys |
| **Demo mode is opt-in, auth fails closed** | `DEMO_MODE=true` enables demo tokens; without it every token is rejected, and the server won't start without `DATABASE_DIR` |
| **PGlite** (Postgres compiled to WebAssembly) | Real Postgres SQL with `pnpm install` only; tests run against the real database, not a mock |

## Tests

`pnpm test`: **48 tests, usually in 10–20 seconds** (under 30 on a busy machine). Every API call in the tests also checks the response against the contract (declared status, content type, schema, no undeclared fields), so whatever a test is about, it is also a contract test.

They cover the mockup's numbers, empty states, roles, the Stockholm month boundary, refunds and declined payments, cards for non-members and currency mismatches rejected by Postgres, pagination across 3 pages with microsecond ties, tampered cursors, idempotent activation, 401/404/409 cases, and a server that refuses to start when misconfigured.

Each test was checked by **breaking the code on purpose** and watching it fail. That found one test that could never fail, now fixed.

## Task 1: this repository is the workflow

Task 1 asks how frontend and backend can work in parallel. This project was built that way, so every step can be shown, not just described:

| Step | Who | What lets the other side move on without waiting |
|---|---|---|
| 1. Agree the contract | Frontend + backend, reviewed like code | [`contract/openapi.yaml`](contract/openapi.yaml), with named examples for each screen state (`activeCustomer`, `newCustomer`, each error) |
| 2. Build on the mock | Frontend | `pnpm mock`: real responses on day 1, any state on demand with `Prefer: example=…` |
| 3. Implement | Backend | Types generated from the contract: if code and contract disagree, the build fails |
| 4. Prove it | CI | Every API test checks the response against the contract; next, `oasdiff` blocks breaking changes in a pull request |

The presentation itself (problems, proposal, Qred’s values, rollout) is a separate deck, shown in the interview.

Mistakes surfaced at step 1 or 2, while they cost nothing: the mock showed wrong error examples and a missing `uniqueItems`, and reviewing the contract moved transactions from the company to the card ("**your** limit").

## Open question for the PM

**A blocked card that has also expired: which status does the app show?** Today `expired` wins (it's a fact of the date). If `blocked` should win, because it tells the customer to contact support, the test in `src/domain/rules.test.ts` changes first, then one line in `rules.ts`.

## What I would do with more time

**Production readiness**
- Real **JWT verification** against the identity provider; demo tokens only in local development.
- A **hosted Postgres** (RDS / Cloud SQL) with a connection pool, where the dashboard's queries really run in parallel.
- **Rate limiting**, stricter on `POST /activate`; an **audit log** of activations (who, when, from where).
- **OpenTelemetry** tracing and metrics; `/docs` behind internal auth.

**API**
- **ETag** on the dashboard (`304 Not Modified` when nothing changed).
- **Sign the cursor** (HMAC), so the server rejects any cursor it didn't issue.
- Transaction **filters** (date, status, category) once the transaction screen is designed; a company-wide view for admins.
- An **`Idempotency-Key`** header for future non-idempotent actions (payments, limit changes).

**Data**
- A double-entry **ledger** for balances instead of summing transactions.
- **Row-level security** as a second barrier; per-company **time zone and currency** for other markets.

**Quality and workflow**
- **CI** running `pnpm check` on every pull request, plus **`oasdiff`** to block breaking contract changes.
- **Schemathesis** to fuzz the API from the contract; **Stryker** for automated mutation testing.
- **Concurrency tests** on a real Postgres (two simultaneous activations).
