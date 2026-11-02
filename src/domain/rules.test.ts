// Stockholm is UTC+1 in winter: 23:00 UTC on 31 Oct is already 1 Nov.
import { describe, expect, it } from 'vitest';
import {
  availableCardActions,
  canSeeInvoices,
  computeSpending,
  effectiveCardStatus,
  invoiceDisplayStatus,
  localToday,
} from './rules.js';

describe('localToday', () => {
  it('uses the Stockholm calendar, not UTC', () => {
    expect(localToday(new Date('2026-10-31T22:59:00Z')).date).toBe('2026-10-31');
    expect(localToday(new Date('2026-10-31T23:00:00Z'))).toEqual({ date: '2026-11-01', year: 2026, month: 11 });
  });
});

describe('effectiveCardStatus', () => {
  const card = { status: 'active', expiryMonth: 11, expiryYear: 2026 } as const;

  it('keeps the stored status until the end of the expiry month, in Stockholm time', () => {
    expect(effectiveCardStatus(card, new Date('2026-11-30T22:59:59Z'))).toBe('active'); // 30 Nov 23:59:59
  });

  it('returns expired from the first day after the expiry month', () => {
    expect(effectiveCardStatus(card, new Date('2026-11-30T23:00:00Z'))).toBe('expired'); // 1 Dec 00:00
    expect(effectiveCardStatus({ ...card, expiryYear: 2025, expiryMonth: 12 }, new Date('2026-01-15T12:00:00Z'))).toBe('expired');
  });

  // Expired wins over blocked for now. Open question for the PM.
  it('reports expired even when the card is also blocked (rule to confirm with the PM)', () => {
    expect(effectiveCardStatus({ ...card, status: 'blocked' }, new Date('2026-12-05T12:00:00Z'))).toBe('expired');
  });
});

describe('availableCardActions', () => {
  it('offers activation only for an inactive card', () => {
    expect(availableCardActions('inactive')).toEqual(['activate']);
    for (const status of ['active', 'frozen', 'blocked', 'expired'] as const) {
      expect(availableCardActions(status)).toEqual([]);
    }
  });
});

describe('computeSpending', () => {
  it('computes "5 400 / 10 000 kr" from the limit and what was spent', () => {
    expect(computeSpending(1_000_000, 460_000)).toEqual({ limit: 1_000_000, spent: 460_000, remaining: 540_000 });
  });

  it('floors spent at 0 when refunds exceed purchases this month', () => {
    expect(computeSpending(1_000_000, -140_000)).toEqual({ limit: 1_000_000, spent: 0, remaining: 1_000_000 });
  });

  it('never shows a negative remaining amount', () => {
    expect(computeSpending(1_000_000, 1_200_000)).toEqual({ limit: 1_000_000, spent: 1_200_000, remaining: 0 });
  });
});

describe('canSeeInvoices', () => {
  it('shows the company invoice to owners and admins only', () => {
    expect(canSeeInvoices('owner')).toBe(true);
    expect(canSeeInvoices('admin')).toBe(true);
    expect(canSeeInvoices('cardholder')).toBe(false);
  });
});

describe('invoiceDisplayStatus', () => {
  it('is due until the end of the due date, and overdue from midnight in Stockholm', () => {
    expect(invoiceDisplayStatus('2026-11-15', new Date('2026-11-15T22:59:59Z'))).toBe('due'); // 15 Nov 23:59:59
    expect(invoiceDisplayStatus('2026-11-15', new Date('2026-11-15T23:00:00Z'))).toBe('overdue'); // 16 Nov 00:00
  });
});
