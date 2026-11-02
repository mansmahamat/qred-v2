import { buildApp } from './app.js';
import { rejectAllTokens } from './auth.js';
import { config } from './config.js';
import { createDatabase } from './db/client.js';
import { seed } from './db/seed.js';

// Fail fast instead of silently running on in-memory data.
if (!config.demoMode && !config.databaseDir) {
  console.error('DATABASE_DIR is required outside demo mode. For the demo, run `pnpm start` (sets DEMO_MODE=true).');
  process.exit(1);
}

const { db, client } = await createDatabase(config.databaseDir);

// Demo: fresh in-memory DB on every start, so a restart resets the demo.
if (config.demoMode && !config.databaseDir) await seed(db);

// Demo login only exists in demo mode.
const verifyToken = config.demoMode ? (await import('./demo.js')).demoTokens : rejectAllTokens;

const app = await buildApp({
  db,
  verifyToken,
  logger: {
    level: config.logLevel,
    redact: ['req.headers.authorization'],
    ...(process.stdout.isTTY ? { transport: { target: 'pino-pretty' } } : {}),
  },
});

if (!config.demoMode) app.log.warn('Demo mode is off and JWT verification is not implemented: every request will be 401.');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await client.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
app.log.info(`Docs: http://localhost:${config.port}/docs`);
