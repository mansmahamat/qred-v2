import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { cards, companies, companyMemberships, invoices, transactions, users } from './schema.js';

/** Same ids as the contract examples, so switching from the mock changes nothing. */
export const demo = {
  users: {
    anna: 'a0000000-0000-4000-8000-000000000001', // owner, has the mockup card
    bob: 'a0000000-0000-4000-8000-000000000002', // cardholder, inactive card
    carl: 'a0000000-0000-4000-8000-000000000003', // other company
  },
  companies: {
    companyAb: '3f1c2a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b',
    secondCompanyAb: '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d', // Anna is a member, no card (empty states)
    otherCompany: 'c0000000-0000-4000-8000-000000000003',
  },
  cards: {
    anna: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    bob: 'b0000000-0000-4000-8000-000000000002',
    carl: 'b0000000-0000-4000-8000-000000000003',
  },
  invoices: {
    companyAbOpen: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
    companyAbPaid: 'd0000000-0000-4000-8000-000000000002',
  },
} as const;

const DAY = 24 * 60 * 60 * 1000;

/** Fixed so cursors and tests can refer to them. */
const transactionId = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Seeded PRNG: same data on every run.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const merchants = [
  { name: 'Clas Ohlson', category: 'office_supplies' },
  { name: 'SJ AB', category: 'travel' },
  { name: 'Adobe', category: 'software' },
  { name: 'Circle K', category: 'fuel' },
  { name: 'Scandic Hotels', category: 'travel' },
  { name: 'Staples', category: 'office_supplies' },
  { name: 'Google Workspace', category: 'software' },
  { name: 'Max Burgers', category: 'restaurants' },
  { name: 'Biltema', category: 'equipment' },
  { name: 'PostNord', category: 'shipping' },
] as const;

type NewTransaction = typeof transactions.$inferInsert;

/** Wipes and refills. Dates are relative to `now`. Anna: 4 600 of 10 000 kr spent, 57 transactions (3 + "54 more"). */
export async function seed(db: Database, now = new Date()) {
  const periodRows = await db.execute<{ start: string }>(
    sql`select (date_trunc('month', ${now.toISOString()}::timestamptz at time zone 'Europe/Stockholm')
               at time zone 'Europe/Stockholm') as start`,
  );
  const periodStart = new Date(periodRows.rows[0]!.start);

  await db.transaction(async (tx) => {
    await tx.delete(transactions);
    await tx.delete(invoices);
    await tx.delete(cards);
    await tx.delete(companyMemberships);
    await tx.delete(companies);
    await tx.delete(users);

    await tx.insert(users).values([
      { id: demo.users.anna, email: 'anna@companyab.se', fullName: 'Anna Andersson' },
      { id: demo.users.bob, email: 'bob@companyab.se', fullName: 'Bob Berg' },
      { id: demo.users.carl, email: 'carl@othercompany.se', fullName: 'Carl Carlsson' },
    ]);

    await tx.insert(companies).values([
      { id: demo.companies.companyAb, name: 'Company AB', organisationNumber: '556677-8899' },
      { id: demo.companies.secondCompanyAb, name: 'Second Company AB', organisationNumber: '559900-1122' },
      { id: demo.companies.otherCompany, name: 'Other Company AB', organisationNumber: '556000-3333' },
    ]);

    await tx.insert(companyMemberships).values([
      { userId: demo.users.anna, companyId: demo.companies.companyAb, role: 'owner' },
      { userId: demo.users.anna, companyId: demo.companies.secondCompanyAb, role: 'admin' },
      { userId: demo.users.bob, companyId: demo.companies.companyAb, role: 'cardholder' },
      { userId: demo.users.carl, companyId: demo.companies.otherCompany, role: 'owner' },
    ]);

    const card = {
      expiryMonth: 9,
      expiryYear: 2029,
      imageUrl: 'https://cdn.qred.example/cards/standard.png',
      currency: 'SEK',
    } as const;
    await tx.insert(cards).values([
      // has a history, so it is active
      {
        ...card,
        id: demo.cards.anna,
        companyId: demo.companies.companyAb,
        holderUserId: demo.users.anna,
        last4: '4242',
        status: 'active',
        spendingLimitMinorUnits: 1_000_000,
        activatedAt: new Date(now.getTime() - 120 * DAY),
      },
      // for the "Activate card" demo
      {
        ...card,
        id: demo.cards.bob,
        companyId: demo.companies.companyAb,
        holderUserId: demo.users.bob,
        last4: '1881',
        status: 'inactive',
        spendingLimitMinorUnits: 500_000,
      },
      {
        ...card,
        id: demo.cards.carl,
        companyId: demo.companies.otherCompany,
        holderUserId: demo.users.carl,
        last4: '7007',
        status: 'active',
        spendingLimitMinorUnits: 2_000_000,
        activatedAt: new Date(now.getTime() - 30 * DAY),
      },
    ]);

    // This month. Counted (purchases − refunds, pending + settled): 460 000 öre.
    const thisMonth: Omit<NewTransaction, 'cardId' | 'currency' | 'occurredAt'>[] = [
      { merchantName: 'Scandic Hotels', category: 'travel', amountMinorUnits: 215_500, type: 'purchase', status: 'settled' },
      { merchantName: 'Circle K', category: 'fuel', amountMinorUnits: 150_000, type: 'purchase', status: 'settled' },
      // declined: listed, not counted
      { merchantName: 'Apple', category: 'equipment', amountMinorUnits: 1_299_000, type: 'purchase', status: 'declined' },
      { merchantName: 'Adobe', category: 'software', amountMinorUnits: 29_900, type: 'refund', status: 'settled' },
      { merchantName: 'SJ AB', category: 'travel', amountMinorUnits: 89_500, type: 'purchase', status: 'pending' },
      { merchantName: 'Clas Ohlson', category: 'office_supplies', amountMinorUnits: 34_900, type: 'purchase', status: 'settled' },
    ];
    // keep them inside the current month
    const span = now.getTime() - periodStart.getTime();
    const annaThisMonth: NewTransaction[] = thisMonth.map((t, i) => ({
      ...t,
      id: transactionId(i + 1),
      cardId: demo.cards.anna,
      currency: 'SEK',
      occurredAt: new Date(periodStart.getTime() + (span * (i + 1)) / (thisMonth.length + 1)),
    }));

    // 51 older ones over ~110 days
    const random = mulberry32(42);
    const annaHistory: NewTransaction[] = Array.from({ length: 51 }, (_, i) => {
      const merchant = merchants[Math.floor(random() * merchants.length)]!;
      const r = random();
      return {
        id: transactionId(thisMonth.length + i + 1),
        cardId: demo.cards.anna,
        merchantName: merchant.name,
        category: merchant.category,
        amountMinorUnits: 5_000 + Math.floor(random() * 300_000),
        currency: 'SEK',
        type: r < 0.06 ? 'refund' : 'purchase',
        status: r > 0.95 ? 'declined' : 'settled',
        occurredAt: new Date(periodStart.getTime() - DAY - Math.floor(random() * 110 * DAY)),
      };
    });

    // must never show up for Anna
    const carlHistory: NewTransaction[] = Array.from({ length: 5 }, (_, i) => ({
      id: transactionId(101 + i),
      cardId: demo.cards.carl,
      merchantName: 'Max Burgers',
      category: 'restaurants',
      amountMinorUnits: 12_900,
      currency: 'SEK',
      type: 'purchase',
      status: 'settled',
      occurredAt: new Date(now.getTime() - (i + 1) * DAY),
    }));

    await tx.insert(transactions).values([...annaThisMonth, ...annaHistory, ...carlHistory]);

    const isoDate = (d: Date) => d.toISOString().slice(0, 10);
    await tx.insert(invoices).values([
      {
        id: demo.invoices.companyAbPaid,
        companyId: demo.companies.companyAb,
        amountMinorUnits: 412_300,
        currency: 'SEK',
        dueDate: isoDate(new Date(now.getTime() - 16 * DAY)),
        status: 'paid',
        paidAt: new Date(now.getTime() - 18 * DAY),
      },
      {
        id: demo.invoices.companyAbOpen,
        companyId: demo.companies.companyAb,
        amountMinorUnits: 125_000,
        currency: 'SEK',
        dueDate: isoDate(new Date(now.getTime() + 14 * DAY)),
        status: 'open',
      },
    ]);
  });
}
