# Qred card dashboard API

The backend for the mobile card dashboard in Appendix 1 of the case: company switcher, due invoice, card and activation, remaining spend, latest transactions and support. Node.js, TypeScript, Fastify, PostgreSQL.

## Quick start

Needs **Node 24+** and **pnpm 11** (`npm install -g pnpm@11`). No Docker and no database to install: Postgres runs inside the process (PGlite).

```bash
pnpm install
```

```bash
pnpm start
```

The API runs on <http://localhost:8080>, with interactive docs on <http://localhost:8080/docs>.

```bash
curl -s -H "Authorization: Bearer anna" localhost:8080/v1/companies/3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b/dashboard | jq
```

`pnpm start` runs in demo mode with three users. Restarting resets the data.

| Token | Who | What they see |
|---|---|---|
| `anna` | Owner of Company AB | The mockup: 5 400 / 10 000 kr left, 3 of 57 transactions, an invoice due |
| `bob` | Cardholder at Company AB | A new card to activate, no invoice (only owners and admins see it) |
| `carl` | Customer of another company | 404 on Company AB |

`pnpm test` runs the 48 tests. `pnpm mock` serves a mock of the API on `:4010`, with no backend code.

## 1. Database schema and payload

```
users ──< company_memberships (role) >── companies ──< invoices
                    │
                    └──< cards ──< transactions
```

- **Store facts, compute the rest.** "Spent", "remaining", "expired" and "overdue" are calculated from transactions and dates, so they can never be out of date.
- **Money is an integer in öre** plus a currency, never a decimal.
- **The database guards the data too.** A card's holder must belong to the card's company, and a transaction must be in its card's currency.
- **One index serves the screen**: latest transactions, pagination and this month's spending all use `(card_id, occurred_at, id)`.

The payload is shaped for the screen, not for the tables. One call returns everything the dashboard shows:

```json
{
  "company":   { "name": "Company AB", "organisationNumber": "556677-8899" },
  "dueInvoice": { "amount": { "minorUnits": 125000, "currency": "SEK" }, "dueDate": "2026-11-15", "status": "due" },
  "card":      { "last4": "4242", "status": "active", "availableActions": [] },
  "spending":  { "limit": { "minorUnits": 1000000, "currency": "SEK" }, "remaining": { "minorUnits": 540000, "currency": "SEK" } },
  "latestTransactions": { "items": ["… 3 transactions …"], "totalCount": 57 },
  "support":   { "phone": "+46 8 123 456 78" }
}
```

(Shortened: ids and some fields left out.)

- "54 more items" is `totalCount − items.length`.
- The app shows "Activate card" only if `availableActions` contains `"activate"`, so the rule lives in the backend.
- A new customer gets `null` for the card and the invoice, so the app always gets the same shape.

## 2. API structure

| Endpoint | On the screen |
|---|---|
| `GET /v1/companies` | The "Company AB ▾" switcher |
| `GET /v1/companies/{id}/dashboard` | The whole screen, in one request |
| `GET /v1/companies/{id}/cards/{cardId}/transactions` | "54 more items", with cursor pagination |
| `POST /v1/companies/{id}/cards/{cardId}/activate` | "Activate card" |

The API is defined first, in [`contract/openapi.yaml`](contract/openapi.yaml). The frontend can build against its mock from day one, and the backend reads its routes and response shapes from the same file.

```
src/
  routes.ts          HTTP only
  services.ts        use cases and access checks
  domain/rules.ts    business rules (spending month, expiry, who sees the invoice)
  repositories.ts    all SQL
  db/schema.ts       tables and constraints
test/
  api.test.ts        real HTTP calls on a real Postgres, with a frozen clock
```

### Adding an endpoint

1. Describe it in `contract/openapi.yaml` (path, `operationId`, responses), then `pnpm contract:lint`.
2. `pnpm contract:types` regenerates `src/contract/types.ts`.
3. Add the route in `src/routes.ts` with `contractRoute('<operationId>')`: the URL and validation come from the contract.
4. Write the use case in `src/services.ts` and any SQL in `src/repositories.ts`.
5. Add tests in `test/api.test.ts`. Responses are checked against the contract automatically.

The frontend can use the new endpoint on the mock (`pnpm mock`) as soon as step 1 is merged.

## 3. Implementation choices

| Choice | Why |
|---|---|
| One dashboard endpoint | One round trip on a mobile network |
| Transactions per card, not per company | The screen says "**your** limit"; colleagues' purchases stay private |
| 404 for someone else's company | A 403 would confirm that it exists |
| Activation is safe to retry | On a bad network the app may retry; an already active card returns 200, not an error |
| The month starts at midnight in Stockholm | Not in UTC: a purchase at 00:30 on 1 November belongs to November |

Every test also checks the response against the contract, so the API can't drift from what the frontend was promised. The tests cover the mockup's numbers, empty states, roles, the month boundary, pagination, bad input and activation.

## Task 1

This repository follows the process from my presentation: contract first, then a mock the frontend can use, then the backend, with tests holding both to the same contract.

## Open question for the PM

A card that is both blocked and expired: which status should the app show? Today it shows "expired". Changing it is one line in `src/domain/rules.ts` and its test.

## Known limitations

- `contractRoute` reads only what this contract uses: path and query parameters and JSON responses. An endpoint with a request body needs it to read `requestBody` too.
- If someone holds several cards in one company, the dashboard shows the newest one.
- The transactions endpoint counts all of the card's transactions on every page, and the dashboard sums the month on every request. Fine at this size, but it would need a cached total for very active cards.
- PGlite has a single connection, so the dashboard's parallel queries still run one after another in the demo.
- The support details come from config, not from the database.
- Demo users have fixed tokens. Without `DEMO_MODE=true`, every token is rejected until a real verifier is plugged in.

## With more time

- Real login instead of the demo tokens.
- A hosted Postgres instead of PGlite.
- Support for request bodies in `contractRoute`, for endpoints like "freeze card".
- Filters on the transaction list, for example by month.
