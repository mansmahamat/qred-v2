// Pure business rules: no database, no HTTP.
import { config } from '../config.js';

export type Role = 'owner' | 'admin' | 'cardholder';
export type StoredCardStatus = 'inactive' | 'active' | 'frozen' | 'blocked';
export type CardStatus = StoredCardStatus | 'expired';
export type CardAction = 'activate';

/** Today's date in Stockholm (00:30 on 1 Nov is still 31 Oct in UTC). */
export function localToday(now: Date) {
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timeZone }).format(now); // YYYY-MM-DD
  const [year, month] = date.split('-').map(Number) as [number, number];
  return { date, year, month };
}

/** Valid until the end of the expiry month. */
export function effectiveCardStatus(
  card: { status: StoredCardStatus; expiryMonth: number; expiryYear: number },
  now: Date,
): CardStatus {
  const today = localToday(now);
  const expired =
    card.expiryYear < today.year || (card.expiryYear === today.year && card.expiryMonth < today.month);
  return expired ? 'expired' : card.status;
}

export function availableCardActions(status: CardStatus): CardAction[] {
  return status === 'inactive' ? ['activate'] : [];
}

/** Floored at 0, e.g. a refund for last month landing this month. TODO: confirm with the PM. */
export function computeSpending(limitMinorUnits: number, netSpentMinorUnits: number) {
  const spent = Math.max(0, netSpentMinorUnits);
  return { limit: limitMinorUnits, spent, remaining: Math.max(0, limitMinorUnits - spent) };
}

/** Invoices are company debt: owners and admins only. */
export function canSeeInvoices(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

/** Computed, so it flips at midnight without a job. */
export function invoiceDisplayStatus(dueDate: string, now: Date): 'due' | 'overdue' {
  return dueDate < localToday(now).date ? 'overdue' : 'due';
}
