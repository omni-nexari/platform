import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgresql://ds:Samsung%402026!@localhost:5432/ds';

const client = postgres(connectionString, {
  // Suppress NOTICE-level messages (e.g. "column already exists, skipping"
  // from ADD COLUMN IF NOT EXISTS guards in startup schema-check functions).
  onnotice: () => {},
});
export const db = drizzle(client, { schema });
export type DB = typeof db;

export * from './schema/index.js';
