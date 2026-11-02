// Thin HTTP layer. Paths and schemas come from the contract.
import type { FastifyInstance } from 'fastify';
import { contractRoute } from './contract/openapi.js';
import type { operations } from './contract/types.js';
import * as services from './services.js';
import type { Deps } from './services.js';

type Path<Op extends keyof operations> = operations[Op]['parameters']['path'];
type Query<Op extends keyof operations> = NonNullable<operations[Op]['parameters']['query']>;

export function registerRoutes(app: FastifyInstance, deps: Deps) {
  app.route({
    ...contractRoute('listCompanies'),
    handler: (request) => services.listCompanies(deps, request.userId),
  });

  app.route<{ Params: Path<'getDashboard'> }>({
    ...contractRoute('getDashboard'),
    handler: (request) => services.getDashboard(deps, request.userId, request.params.companyId),
  });

  app.route<{ Params: Path<'listCardTransactions'>; Querystring: Query<'listCardTransactions'> }>({
    ...contractRoute('listCardTransactions'),
    handler: (request) => {
      const { companyId, cardId } = request.params;
      // Always set: the default comes from the contract.
      const limit = request.query.limit as number;
      return services.listCardTransactions(deps, request.userId, companyId, cardId, limit, request.query.cursor);
    },
  });

  app.route<{ Params: Path<'activateCard'> }>({
    ...contractRoute('activateCard'),
    handler: (request) => {
      const { companyId, cardId } = request.params;
      return services.activateCard(deps, request.userId, companyId, cardId);
    },
  });
}
