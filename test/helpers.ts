import { buildApp } from '../src/app.js';
import type { components, operations } from '../src/contract/types.js';
import type { PGlite } from '@electric-sql/pglite';
import { createDatabase, databaseFrom } from '../src/db/client.js';
import { demo, seed } from '../src/db/seed.js';
import { demoTokens } from '../src/demo.js';
import { expectToMatchContract } from './contract.js';

type Schemas = components['schemas'];

/** Mid-month, so this month's transactions span 20 days. */
export const NOW = new Date('2026-11-20T10:00:00Z');
export const DAY = 24 * 60 * 60 * 1000;
export { demo };

// Migrate + seed once per file, then clone per test: isolated and fast.
let template: Promise<PGlite> | undefined;
function seededTemplate() {
  template ??= createDatabase().then(async ({ db, client }) => {
    await seed(db, NOW);
    return client;
  });
  return template;
}

/** A fresh database clone and the app, with a clock the test can move (`setNow`). */
export async function setup({ now = NOW }: { now?: Date } = {}) {
  const client = (await (await seededTemplate()).clone()) as PGlite;
  const db = databaseFrom(client);
  let current = now;
  const app = await buildApp({ db, clock: () => current, verifyToken: demoTokens });

  /** Also checks the response against the contract. */
  async function call<T>(operationId: keyof operations, method: 'GET' | 'POST', url: string, token?: string) {
    const response = await app.inject({
      method,
      url,
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
    expectToMatchContract(operationId, response);
    // `body` for success, `problem` for errors. One type can't do both: Card.status is a string, Problem.status a number.
    return {
      status: response.statusCode,
      body: response.json<T>(),
      problem: response.json<Schemas['Problem']>(),
    };
  }

  const api = {
    companies: (token?: string) => call<Schemas['CompanyList']>('listCompanies', 'GET', '/v1/companies', token),
    dashboard: (token: string, companyId: string) =>
      call<Schemas['Dashboard']>('getDashboard', 'GET', `/v1/companies/${companyId}/dashboard`, token),
    transactions: (token: string, companyId: string, cardId: string, query = '') =>
      call<Schemas['TransactionPage']>(
        'listCardTransactions',
        'GET',
        `/v1/companies/${companyId}/cards/${cardId}/transactions${query}`,
        token,
      ),
    activate: (token: string, companyId: string, cardId: string) =>
      call<Schemas['Card']>('activateCard', 'POST', `/v1/companies/${companyId}/cards/${cardId}/activate`, token),
  };

  return {
    app,
    db,
    api,
    setNow: (date: Date) => {
      current = date;
    },
    close: async () => {
      await app.close();
      await client.close();
    },
  };
}

export type TestContext = Awaited<ReturnType<typeof setup>>;
