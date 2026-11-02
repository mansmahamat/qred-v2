import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// Money: bigint minor units (öre) + ISO currency. mode 'number' is safe up to ~90 trillion kr.
const minorUnits = (name: string) => bigint(name, { mode: 'number' }).notNull();
const currency = () => char('currency', { length: 3 }).notNull();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const membershipRole = pgEnum('membership_role', ['owner', 'admin', 'cardholder']);
// No 'expired': it's computed from the expiry date.
export const cardStatus = pgEnum('card_status', ['inactive', 'active', 'frozen', 'blocked']);
export const spendingPeriod = pgEnum('spending_period', ['monthly']);
export const transactionType = pgEnum('transaction_type', ['purchase', 'refund']);
export const transactionStatus = pgEnum('transaction_status', ['pending', 'settled', 'declined']);
// "due" / "overdue" is computed from the date, not stored.
export const invoiceStatus = pgEnum('invoice_status', ['open', 'paid', 'cancelled']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  fullName: text('full_name').notNull(),
  createdAt: createdAt(),
});

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  organisationNumber: text('organisation_number').notNull().unique(),
  createdAt: createdAt(),
});

// A user can belong to several companies.
export const companyMemberships = pgTable(
  'company_memberships',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    companyId: uuid('company_id').notNull().references(() => companies.id),
    role: membershipRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.companyId] }),
    index('company_memberships_company_idx').on(t.companyId),
  ],
);

// Last 4 digits only, never the full card number (PCI DSS).
export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id),
    holderUserId: uuid('holder_user_id').notNull().references(() => users.id),
    last4: char('last4', { length: 4 }).notNull(),
    expiryMonth: smallint('expiry_month').notNull(),
    expiryYear: smallint('expiry_year').notNull(),
    status: cardStatus('status').notNull().default('inactive'),
    imageUrl: text('image_url').notNull(),
    spendingLimitMinorUnits: minorUnits('spending_limit_minor_units'),
    spendingPeriod: spendingPeriod('spending_period').notNull().default('monthly'),
    currency: currency(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // dashboard: my card in this company
    index('cards_company_holder_idx').on(t.companyId, t.holderUserId),
    // The holder must be a member of the card's company.
    foreignKey({
      name: 'cards_holder_membership_fk',
      columns: [t.holderUserId, t.companyId],
      foreignColumns: [companyMemberships.userId, companyMemberships.companyId],
    }),
    // for the transactions (card_id, currency) FK
    unique('cards_id_currency_unique').on(t.id, t.currency),
    check('cards_expiry_month_check', sql`${t.expiryMonth} between 1 and 12`),
    check('cards_spending_limit_check', sql`${t.spendingLimitMinorUnits} >= 0`),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id').notNull(),
    merchantName: text('merchant_name').notNull(),
    category: text('category').notNull(),
    // Always positive; `type` gives the direction.
    amountMinorUnits: minorUnits('amount_minor_units'),
    // Always the card's currency (converted), enforced by the FK below.
    currency: currency(),
    type: transactionType('type').notNull(),
    status: transactionStatus('status').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // Covers the latest 3, pagination and spent this month.
    index('transactions_card_occurred_idx').on(t.cardId, t.occurredAt.desc(), t.id.desc()),
    // Same card AND same currency, so spent never mixes currencies.
    foreignKey({
      name: 'transactions_card_currency_fk',
      columns: [t.cardId, t.currency],
      foreignColumns: [cards.id, cards.currency],
    }),
    check('transactions_amount_check', sql`${t.amountMinorUnits} > 0`),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id').notNull().references(() => companies.id),
    amountMinorUnits: minorUnits('amount_minor_units'),
    currency: currency(),
    dueDate: date('due_date').notNull(),
    status: invoiceStatus('status').notNull().default('open'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // next open invoice
    index('invoices_company_status_due_idx').on(t.companyId, t.status, t.dueDate),
    check('invoices_amount_check', sql`${t.amountMinorUnits} > 0`),
  ],
);
