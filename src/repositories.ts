// All SQL lives here.
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { config } from './config.js';
import type { Database } from './db/client.js';
import { cards, companies, companyMemberships, invoices, transactions, users } from './db/schema.js';

export type CardRow = typeof cards.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;

const companyColumns = {
  id: companies.id,
  name: companies.name,
  organisationNumber: companies.organisationNumber,
};

export function listCompaniesOfUser(db: Database, userId: string) {
  return db
    .select(companyColumns)
    .from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(eq(companyMemberships.userId, userId))
    .orderBy(asc(companies.name));
}

/** Company + role, or undefined if not a member. */
export async function findMembership(db: Database, userId: string, companyId: string) {
  const [row] = await db
    .select({ role: companyMemberships.role, company: companyColumns })
    .from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(and(eq(companyMemberships.userId, userId), eq(companyMemberships.companyId, companyId)))
    .limit(1);
  return row;
}

const cardWithHolder = { card: cards, holderName: users.fullName };
export type CardWithHolder = { card: CardRow; holderName: string };

/** The most recent one if they have several. */
export async function findCardOfHolder(db: Database, companyId: string, userId: string) {
  const [row] = await db
    .select(cardWithHolder)
    .from(cards)
    .innerJoin(users, eq(users.id, cards.holderUserId))
    .where(and(eq(cards.companyId, companyId), eq(cards.holderUserId, userId)))
    .orderBy(desc(cards.createdAt))
    .limit(1);
  return row;
}

/** Must be in this company AND held by this user. */
export async function findOwnCard(db: Database, companyId: string, cardId: string, userId: string) {
  const [row] = await db
    .select(cardWithHolder)
    .from(cards)
    .innerJoin(users, eq(users.id, cards.holderUserId))
    .where(and(eq(cards.id, cardId), eq(cards.companyId, companyId), eq(cards.holderUserId, userId)))
    .limit(1);
  return row;
}

/** Only inactive → active, so a racing second request updates nothing. */
export async function activateCard(db: Database, cardId: string, now: Date) {
  const updated = await db
    .update(cards)
    .set({ status: 'active', activatedAt: now })
    .where(and(eq(cards.id, cardId), eq(cards.status, 'inactive')))
    .returning({ id: cards.id });
  return updated.length === 1;
}

/** Purchases minus refunds (pending + settled) this month, Stockholm time. */
export async function netSpentThisMonth(db: Database, cardId: string, now: Date) {
  const periodStart = sql`date_trunc('month', ${now.toISOString()}::timestamptz at time zone ${config.timeZone}) at time zone ${config.timeZone}`;
  const [row] = await db
    .select({
      net: sql<number>`coalesce(sum(case ${transactions.type} when 'purchase' then ${transactions.amountMinorUnits} else -${transactions.amountMinorUnits} end), 0)`.mapWith(
        Number,
      ),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.cardId, cardId),
        inArray(transactions.status, ['pending', 'settled']),
        sql`${transactions.occurredAt} >= ${periodStart}`,
      ),
    );
  return row?.net ?? 0;
}

export async function countTransactions(db: Database, cardId: string) {
  const [row] = await db.select({ total: count() }).from(transactions).where(eq(transactions.cardId, cardId));
  return row?.total ?? 0;
}

/** occurred_at in µs since epoch (digits only) + id. */
export type TransactionCursor = { micros: string; id: string };

/** Newest first, keyset on (occurred_at, id). µs as a string keep Postgres precision (a JS Date rounds to ms). */
export function listTransactions(db: Database, cardId: string, limit: number, after?: TransactionCursor) {
  return db
    .select({
      transaction: transactions,
      cursorMicros: sql<string>`(extract(epoch from ${transactions.occurredAt}) * 1000000)::bigint::text`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.cardId, cardId),
        after
          ? sql`(${transactions.occurredAt}, ${transactions.id}) < (timestamptz 'epoch' + ${after.micros}::bigint * interval '1 microsecond', ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(limit);
}

/** Open, earliest due date first. */
export async function findNextOpenInvoice(db: Database, companyId: string) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.companyId, companyId), eq(invoices.status, 'open')))
    .orderBy(asc(invoices.dueDate))
    .limit(1);
  return invoice;
}
