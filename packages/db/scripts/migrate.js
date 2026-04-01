/**
 * Custom migration runner for @signage/db.
 *
 * Replaces `drizzle-kit migrate` so we can pass `onnotice: () => {}` to the
 * postgres.js client, suppressing PostgreSQL NOTICE-level messages (e.g.
 * "column already exists, skipping") that appear when idempotent migrations
 * are re-evaluated against an already-up-to-date schema.
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgresql://ds:Samsung%402026!@localhost:5432/ds';

const client = postgres(connectionString, {
  // Suppress NOTICE-level messages from the server (42701 "column already
  // exists", 42P07 "relation already exists", etc.). These are harmless when
  // migrations use IF NOT EXISTS but produce noisy deploy output.
  onnotice: () => {},
});

const db = drizzle(client);

try {
  await migrate(db, {
    migrationsFolder: resolve(__dirname, '../migrations'),
  });
  console.log('Migrations applied successfully.');
} finally {
  await client.end();
}
