// HTTP tests on an in-memory Postgres with a frozen clock. Every response is also checked against the contract.
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { cards, transactions } from '../src/db/schema.js';
import { expectToMatchContract } from './contract.js';
import { DAY, NOW, demo, setup, type TestContext } from './helpers.js';

const { companyAb, secondCompanyAb, otherCompany } = demo.companies;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** The constraint that rejected the write, so a test can't pass on an unrelated error. */
async function violatedConstraint(write: PromiseLike<unknown>) {
  try {
    await write;
  } catch (error) {
    return (error as { cause?: { constraint?: string } }).cause?.constraint;
  }
  return undefined;
}

let t: TestContext;
afterEach(async () => t?.close());

describe('GET /v1/companies/{companyId}/dashboard', () => {
  beforeEach(async () => {
    t = await setup();
  });

  it('returns the screen of the mockup for Anna', async () => {
    const { status, body } = await t.api.dashboard('anna', companyAb);

    expect(status).toBe(200);
    expect(body.company.name).toBe('Company AB');
    expect(body.dueInvoice).toEqual({
      id: demo.invoices.companyAbOpen,
      amount: { minorUnits: 125_000, currency: 'SEK' },
      dueDate: isoDate(new Date(NOW.getTime() + 14 * DAY)),
      status: 'due',
    });
    expect(body.card).toMatchObject({ id: demo.cards.anna, last4: '4242', status: 'active', availableActions: [] });
    // "5 400 / 10 000 kr"
    expect(body.spending).toEqual({
      limit: { minorUnits: 1_000_000, currency: 'SEK' },
      spent: { minorUnits: 460_000, currency: 'SEK' },
      remaining: { minorUnits: 540_000, currency: 'SEK' },
      period: 'monthly',
    });
    // 3 rows + "54 more items"
    expect(body.latestTransactions.items.map((tx) => tx.merchantName)).toEqual(['Clas Ohlson', 'SJ AB', 'Adobe']);
    expect(body.latestTransactions.totalCount).toBe(57);
    expect(body.support.email).toBe('support@qred.example');
  });

  it('never sends a field that is not in the contract', async () => {
    const { body } = await t.api.dashboard('anna', companyAb);
    expect(Object.keys(body).sort()).toEqual(['card', 'company', 'dueInvoice', 'latestTransactions', 'spending', 'support']);
    expect(Object.keys(body.card!).sort()).toEqual(
      ['availableActions', 'expiryMonth', 'expiryYear', 'holderName', 'id', 'imageUrl', 'last4', 'status'],
    );
  });

  it('returns explicit nulls for a member without a card (empty states)', async () => {
    const { status, body } = await t.api.dashboard('anna', secondCompanyAb);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      company: { name: 'Second Company AB' },
      dueInvoice: null,
      card: null,
      spending: null,
      latestTransactions: { items: [], totalCount: 0 },
    });
  });

  it('hides the company invoice from a cardholder and offers to activate a new card', async () => {
    const { body } = await t.api.dashboard('bob', companyAb);

    expect(body.dueInvoice).toBeNull();
    expect(body.card).toMatchObject({ holderName: 'Bob Berg', status: 'inactive', availableActions: ['activate'] });
    expect(body.spending?.remaining.minorUnits).toBe(500_000);
    expect(body.latestTransactions.totalCount).toBe(0);
  });

  it("returns 404 for a company the user doesn't belong to, the same as for one that doesn't exist", async () => {
    const notMine = await t.api.dashboard('anna', otherCompany);
    const unknown = await t.api.dashboard('anna', '00000000-0000-4000-8000-000000000000');

    expect(notMine).toEqual(unknown);
    expect(notMine.status).toBe(404);
    expect(notMine.problem.code).toBe('COMPANY_NOT_FOUND');
  });

  it('rejects a malformed company id with the exact field', async () => {
    const { status, problem } = await t.api.dashboard('anna', 'abc');
    expect(status).toBe(400);
    expect(problem.code).toBe('VALIDATION_ERROR');
    expect(problem.detail).toContain('companyId');
  });
});

describe('spending rules', () => {
  beforeEach(async () => {
    t = await setup();
  });

  const addTransaction = (values: Partial<typeof transactions.$inferInsert> & { occurredAt: Date }) =>
    t.db.insert(transactions).values({
      cardId: demo.cards.anna,
      merchantName: 'Test',
      category: 'test',
      amountMinorUnits: 10_000,
      currency: 'SEK',
      type: 'purchase',
      status: 'settled',
      ...values,
    });

  it('excludes declined transactions from spent but still lists them', async () => {
    const { body: page } = await t.api.transactions('anna', companyAb, demo.cards.anna);
    expect(page.items).toContainEqual(expect.objectContaining({ merchantName: 'Apple', status: 'declined' }));

    const { body } = await t.api.dashboard('anna', companyAb);
    expect(body.spending?.spent.minorUnits).toBe(460_000); // the 12 990 kr declined purchase is not counted
  });

  it('starts the month at midnight in Stockholm, not UTC', async () => {
    await addTransaction({ amountMinorUnits: 10_000, occurredAt: new Date('2026-10-31T23:30:00Z') }); // 1 Nov 00:30 in Stockholm
    await addTransaction({ amountMinorUnits: 20_000, occurredAt: new Date('2026-10-31T22:30:00Z') }); // 31 Oct 23:30 in Stockholm

    const { body } = await t.api.dashboard('anna', companyAb);
    expect(body.spending?.spent.minorUnits).toBe(470_000); // only the first one counts in November
  });

  it('floors spent at 0 when refunds exceed purchases this month', async () => {
    await addTransaction({ type: 'refund', amountMinorUnits: 600_000, occurredAt: new Date(NOW.getTime() - 60_000) });

    const { body } = await t.api.dashboard('anna', companyAb);
    expect(body.spending).toMatchObject({ spent: { minorUnits: 0 }, remaining: { minorUnits: 1_000_000 } });
  });

  it('refuses, at the database level, a transaction in another currency than its card', async () => {
    expect(await violatedConstraint(addTransaction({ currency: 'EUR', occurredAt: NOW }))).toBe(
      'transactions_card_currency_fk',
    );
  });
});

describe('database integrity', () => {
  beforeEach(async () => {
    t = await setup();
  });

  const addCard = (holderUserId: string) =>
    t.db.insert(cards).values({
      companyId: companyAb,
      holderUserId,
      last4: '9999',
      expiryMonth: 1,
      expiryYear: 2030,
      currency: 'SEK',
      spendingLimitMinorUnits: 100_000,
      imageUrl: 'https://cdn.qred.example/cards/standard.png',
    });

  it('refuses a card held by someone who is not a member of its company', async () => {
    // Carl isn't in Company AB.
    expect(await violatedConstraint(addCard(demo.users.carl))).toBe('cards_holder_membership_fk');
    // control: a member is fine
    expect(await violatedConstraint(addCard(demo.users.bob))).toBeUndefined();
  });
});

describe('time-dependent states', () => {
  it('shows the invoice as overdue and resets spending when the clock moves to next month', async () => {
    t = await setup({ now: new Date(NOW.getTime() + 20 * DAY) }); // 10 December

    const { body } = await t.api.dashboard('anna', companyAb);
    expect(body.dueInvoice?.status).toBe('overdue');
    expect(body.spending?.spent.minorUnits).toBe(0);
  });
});

describe('GET /v1/companies/{companyId}/cards/{cardId}/transactions', () => {
  beforeEach(async () => {
    t = await setup();
  });

  async function readAllPages(limit: number) {
    const ids: string[] = [];
    const dates: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`;
      const { status, body } = await t.api.transactions('anna', companyAb, demo.cards.anna, query);
      expect(status).toBe(200);
      ids.push(...body.items.map((tx) => tx.id));
      dates.push(...body.items.map((tx) => tx.occurredAt));
      cursor = body.nextCursor;
      pages++;
    } while (cursor);
    return { ids, dates, pages };
  }

  it('pages through every transaction once, newest first', async () => {
    const { ids, dates, pages } = await readAllPages(20);

    expect(pages).toBe(3); // 20 + 20 + 17
    expect(ids).toHaveLength(57);
    expect(new Set(ids).size).toBe(57);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('uses the contract default of 20 when no limit is given', async () => {
    const { body } = await t.api.transactions('anna', companyAb, demo.cards.anna);
    expect(body.items).toHaveLength(20);
    expect(body.totalCount).toBe(57);
  });

  it('keeps a stable order for transactions at the same microsecond, across page boundaries', async () => {
    // Postgres has µs, JS only ms: the cursor must not round.
    await t.db.execute(sql`
      insert into transactions (id, card_id, merchant_name, category, amount_minor_units, currency, type, status, occurred_at)
      values
        ('f0000000-0000-4000-8000-000000000001', ${demo.cards.anna}, 'Tie A', 'test', 100, 'SEK', 'purchase', 'settled', '2026-11-20 09:59:59.123456+00'),
        ('f0000000-0000-4000-8000-000000000002', ${demo.cards.anna}, 'Tie B', 'test', 100, 'SEK', 'purchase', 'settled', '2026-11-20 09:59:59.123456+00'),
        ('f0000000-0000-4000-8000-000000000003', ${demo.cards.anna}, 'Tie C', 'test', 100, 'SEK', 'purchase', 'settled', '2026-11-20 09:59:59.123457+00')`);

    const { ids } = await readAllPages(2);
    expect(ids.slice(0, 3)).toEqual([
      'f0000000-0000-4000-8000-000000000003', // one microsecond later
      'f0000000-0000-4000-8000-000000000002', // same instant: higher id first
      'f0000000-0000-4000-8000-000000000001',
    ]);
    expect(new Set(ids).size).toBe(60);
  });

  it.each([
    ['not base64 JSON', 'nope'],
    ['an old-format cursor', Buffer.from('{"occurredAt":"2026","id":"x"}').toString('base64url')],
    ['an invalid uuid', Buffer.from('{"micros":"1","id":"------------------------------------"}').toString('base64url')],
    ['a non-numeric timestamp', Buffer.from('{"micros":"12a","id":"00000000-0000-4000-8000-000000000000"}').toString('base64url')],
  ])('returns 400 INVALID_CURSOR for %s, never a 500', async (_label, cursor) => {
    const { status, problem } = await t.api.transactions('anna', companyAb, demo.cards.anna, `?cursor=${cursor}`);
    expect(status).toBe(400);
    expect(problem.code).toBe('INVALID_CURSOR');
  });

  it.each([['0'], ['51'], ['abc']])('rejects limit=%s with the exact field', async (limit) => {
    const { status, problem } = await t.api.transactions('anna', companyAb, demo.cards.anna, `?limit=${limit}`);
    expect(status).toBe(400);
    expect(problem.detail).toContain('limit');
  });

  it("returns 404 for a colleague's card, even in the user's own company", async () => {
    const { status, problem } = await t.api.transactions('anna', companyAb, demo.cards.bob);
    expect(status).toBe(404);
    expect(problem.code).toBe('CARD_NOT_FOUND');
  });
});

describe('POST /v1/companies/{companyId}/cards/{cardId}/activate', () => {
  beforeEach(async () => {
    t = await setup();
  });

  const setBobsCard = (values: Partial<typeof cards.$inferInsert>) =>
    t.db.update(cards).set(values).where(eq(cards.id, demo.cards.bob));

  it('activates an inactive card', async () => {
    const { status, body } = await t.api.activate('bob', companyAb, demo.cards.bob);

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'active', availableActions: [] });
    const { body: dashboard } = await t.api.dashboard('bob', companyAb);
    expect(dashboard.card?.status).toBe('active');
  });

  it('is idempotent: a retry an hour later returns 200 and changes nothing', async () => {
    await t.api.activate('bob', companyAb, demo.cards.bob);

    // Retry later: with a frozen clock, a rewrite would store the same timestamp.
    t.setNow(new Date(NOW.getTime() + 60 * 60 * 1000));
    const retry = await t.api.activate('bob', companyAb, demo.cards.bob);
    const [card] = await t.db.select().from(cards).where(eq(cards.id, demo.cards.bob));

    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe('active');
    expect(card?.activatedAt).toEqual(NOW); // still the first activation, not the retry
  });

  it.each([['blocked'], ['frozen']] as const)('returns 409 for a %s card', async (status) => {
    await setBobsCard({ status });

    const { status: code, problem } = await t.api.activate('bob', companyAb, demo.cards.bob);
    expect(code).toBe(409);
    expect(problem).toMatchObject({ code: 'CARD_NOT_ACTIVATABLE', detail: `The card is ${status}.` });
  });

  it('returns 409 for an expired card, and the dashboard no longer offers to activate it', async () => {
    await setBobsCard({ expiryMonth: 10, expiryYear: 2026 }); // expired since 1 Nov

    const { status, problem } = await t.api.activate('bob', companyAb, demo.cards.bob);
    expect(status).toBe(409);
    expect(problem.detail).toBe('The card is expired.');

    const { body: dashboard } = await t.api.dashboard('bob', companyAb);
    expect(dashboard.card).toMatchObject({ status: 'expired', availableActions: [] });
  });

  it("returns 404 when activating someone else's card", async () => {
    const { status, problem } = await t.api.activate('anna', companyAb, demo.cards.bob);
    expect(status).toBe(404);
    expect(problem.code).toBe('CARD_NOT_FOUND');
  });
});

describe('GET /v1/companies', () => {
  beforeEach(async () => {
    t = await setup();
  });

  it("lists only the user's companies, sorted by name", async () => {
    const anna = await t.api.companies('anna');
    const carl = await t.api.companies('carl');

    expect(anna.body.items.map((c) => c.name)).toEqual(['Company AB', 'Second Company AB']);
    expect(carl.body.items.map((c) => c.name)).toEqual(['Other Company AB']);
  });
});

describe('authentication', () => {
  beforeEach(async () => {
    t = await setup();
  });

  it.each([
    ['no header', undefined],
    ['an unknown token', 'mallory'],
    ['a token in the wrong case', 'ANNA'],
  ])('returns 401 with %s', async (_label, token) => {
    const { status, problem } = await t.api.companies(token);
    expect(status).toBe(401);
    expect(problem.code).toBe('UNAUTHORIZED');
  });

  it('accepts the scheme name in any case (RFC 9110)', async () => {
    const response = await t.app.inject({ url: '/v1/companies', headers: { authorization: 'bearer anna' } });
    expectToMatchContract('listCompanies', response);
    expect(response.statusCode).toBe(200);
  });

  it('fails closed: an app built without a token verifier lets nobody in', async () => {
    const locked = await buildApp({ db: t.db });
    const response = await locked.inject({ url: '/v1/companies', headers: { authorization: 'Bearer anna' } });
    await locked.close();

    expectToMatchContract('listCompanies', response);
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /health', () => {
  beforeEach(async () => {
    t = await setup();
  });

  // The load balancer calls it without a token.
  it('answers without a token', async () => {
    const response = await t.app.inject({ url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('errors outside the contract operations', () => {
  beforeEach(async () => {
    t = await setup();
  });

  it('answers an unknown route with a Problem, not an HTML page', async () => {
    const response = await t.app.inject({ url: '/v1/nope', headers: { authorization: 'Bearer anna' } });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
  });
});
