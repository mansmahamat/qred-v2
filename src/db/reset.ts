import { createDatabase } from './client.js';
import { seed } from './seed.js';

// `pnpm db:reset`: migrate and refill the local demo database.
const dataDir = process.env.DATABASE_DIR ?? '.data/pglite';
const { db, client } = await createDatabase(dataDir);
await seed(db);
await client.close();
console.log(`Database ready in ${dataDir}`);
