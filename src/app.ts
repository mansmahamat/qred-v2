import scalar from '@scalar/fastify-api-reference';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { authenticateWith, rejectAllTokens, type VerifyToken } from './auth.js';
import { contractYaml, registerContractSchemas } from './contract/openapi.js';
import type { Database } from './db/client.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { registerRoutes } from './routes.js';

type AppOptions = {
  db: Database;
  /** Injected so tests can freeze time. */
  clock?: () => Date;
  /** Defaults to rejecting every token. */
  verifyToken?: VerifyToken;
  logger?: FastifyServerOptions['logger'];
};

/** Builds the app without listening, so tests can use inject(). */
export async function buildApp({
  db,
  clock = () => new Date(),
  verifyToken = rejectAllTokens,
  logger = false,
}: AppOptions) {
  const app = Fastify({ logger });

  registerContractSchemas(app);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // Public: health check and docs.
  app.get('/health', async () => ({ status: 'ok' }));
  await app.register(scalar, { routePrefix: '/docs', configuration: { content: contractYaml } });

  // Everything else requires a logged-in user.
  await app.register(async (api) => {
    api.addHook('onRequest', authenticateWith(verifyToken));
    registerRoutes(api, { db, clock });
  });

  return app;
}
