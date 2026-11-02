// Use cases: access check, data, rules. No HTTP here.
import { config } from './config.js';
import { dashboardPreviewSize } from './contract/openapi.js';
import type { components } from './contract/types.js';
import type { Database } from './db/client.js';
import { canSeeInvoices, computeSpending, effectiveCardStatus } from './domain/rules.js';
import { errors } from './errors.js';
import * as repo from './repositories.js';
import { money, serializeCard, serializeInvoice, serializeTransaction } from './serializers.js';

type Schemas = components['schemas'];
export type Deps = { db: Database; clock: () => Date };

async function requireMembership(db: Database, userId: string, companyId: string) {
  const membership = await repo.findMembership(db, userId, companyId);
  if (!membership) throw errors.companyNotFound();
  return membership;
}

async function requireOwnCard(db: Database, userId: string, companyId: string, cardId: string) {
  await requireMembership(db, userId, companyId);
  const card = await repo.findOwnCard(db, companyId, cardId, userId);
  if (!card) throw errors.cardNotFound();
  return card;
}

export async function listCompanies({ db }: Deps, userId: string): Promise<Schemas['CompanyList']> {
  return { items: await repo.listCompaniesOfUser(db, userId) };
}

export async function getDashboard({ db, clock }: Deps, userId: string, companyId: string): Promise<Schemas['Dashboard']> {
  const now = clock();
  const { role, company } = await requireMembership(db, userId, companyId);
  const card = await repo.findCardOfHolder(db, companyId, userId);

  // In parallel (PGlite has one connection, so they still queue in the demo).
  const [invoice, netSpent, latest, totalCount] = await Promise.all([
    canSeeInvoices(role) ? repo.findNextOpenInvoice(db, companyId) : undefined,
    card ? repo.netSpentThisMonth(db, card.card.id, now) : 0,
    card ? repo.listTransactions(db, card.card.id, dashboardPreviewSize) : [],
    card ? repo.countTransactions(db, card.card.id) : 0,
  ]);

  let spending: Schemas['Spending'] | null = null;
  if (card) {
    const { limit, spent, remaining } = computeSpending(card.card.spendingLimitMinorUnits, netSpent);
    const currency = card.card.currency;
    spending = {
      limit: money(limit, currency),
      spent: money(spent, currency),
      remaining: money(remaining, currency),
      period: card.card.spendingPeriod,
    };
  }

  return {
    company,
    dueInvoice: invoice ? serializeInvoice(invoice, now) : null,
    card: card ? serializeCard(card, now) : null,
    spending,
    latestTransactions: { items: latest.map((row) => serializeTransaction(row.transaction)), totalCount },
    support: config.support,
  };
}

// Opaque to the client: base64url JSON.
function encodeCursor(cursor: repo.TransactionCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

const MICROS = /^\d{1,16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Untrusted input: anything invalid is a 400, never a 500.
function decodeCursor(value: string): repo.TransactionCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed === 'object' && parsed !== null &&
      'micros' in parsed && typeof parsed.micros === 'string' && MICROS.test(parsed.micros) &&
      'id' in parsed && typeof parsed.id === 'string' && UUID.test(parsed.id)
    ) {
      return { micros: parsed.micros, id: parsed.id };
    }
  } catch {
    // fall through
  }
  throw errors.invalidCursor();
}

export async function listCardTransactions(
  { db }: Deps,
  userId: string,
  companyId: string,
  cardId: string,
  limit: number,
  cursor?: string,
): Promise<Schemas['TransactionPage']> {
  await requireOwnCard(db, userId, companyId, cardId);
  const after = cursor ? decodeCursor(cursor) : undefined;

  // limit + 1 tells us if there's a next page.
  const [rows, totalCount] = await Promise.all([
    repo.listTransactions(db, cardId, limit + 1, after),
    repo.countTransactions(db, cardId),
  ]);
  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    items: page.map((row) => serializeTransaction(row.transaction)),
    nextCursor: rows.length > limit && last ? encodeCursor({ micros: last.cursorMicros, id: last.transaction.id }) : null,
    totalCount,
  };
}

/** Idempotent: an already active card returns 200. */
export async function activateCard(
  { db, clock }: Deps,
  userId: string,
  companyId: string,
  cardId: string,
): Promise<Schemas['Card']> {
  const now = clock();
  const card = await requireOwnCard(db, userId, companyId, cardId);
  const status = effectiveCardStatus(card.card, now);

  if (status === 'inactive') await repo.activateCard(db, cardId, now);
  else if (status !== 'active') throw errors.cardNotActivatable(status);

  // Re-read in case another request changed it meanwhile.
  const updated = await repo.findOwnCard(db, companyId, cardId, userId);
  if (!updated) throw errors.cardNotFound();
  const finalStatus = effectiveCardStatus(updated.card, now);
  if (finalStatus !== 'active') throw errors.cardNotActivatable(finalStatus);
  return serializeCard(updated, now);
}
