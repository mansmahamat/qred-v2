// DB rows → contract shapes. Types are generated from the YAML.
import type { components } from './contract/types.js';
import type { CardWithHolder, InvoiceRow, TransactionRow } from './repositories.js';
import { availableCardActions, effectiveCardStatus, invoiceDisplayStatus } from './domain/rules.js';

type Schemas = components['schemas'];

export function money(minorUnits: number, currency: string): Schemas['Money'] {
  return { minorUnits, currency };
}

export function serializeCard({ card, holderName }: CardWithHolder, now: Date): Schemas['Card'] {
  const status = effectiveCardStatus(card, now);
  return {
    id: card.id,
    last4: card.last4,
    holderName,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    status,
    imageUrl: card.imageUrl,
    availableActions: availableCardActions(status),
  };
}

export function serializeTransaction(t: TransactionRow): Schemas['Transaction'] {
  return {
    id: t.id,
    merchantName: t.merchantName,
    category: t.category,
    amount: money(t.amountMinorUnits, t.currency),
    type: t.type,
    status: t.status,
    occurredAt: t.occurredAt.toISOString(),
  };
}

export function serializeInvoice(invoice: InvoiceRow, now: Date): Schemas['Invoice'] {
  return {
    id: invoice.id,
    amount: money(invoice.amountMinorUnits, invoice.currency),
    dueDate: invoice.dueDate,
    status: invoiceDisplayStatus(invoice.dueDate, now),
  };
}
