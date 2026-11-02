import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

// PGlite is Postgres in WASM: no Docker for the demo or tests. Production would use node-postgres.
export type Database = ReturnType<typeof drizzle<typeof schema>>;

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

/** Wraps an existing PGlite instance (tests use clones). */
export function databaseFrom(client: PGlite): Database {
  return drizzle({ client, schema });
}

/** No dataDir = in-memory. */
export async function createDatabase(dataDir?: string): Promise<{ db: Database; client: PGlite }> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { db, client };
}
