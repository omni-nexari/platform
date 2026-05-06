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
import { readFileSync, readdirSync } from 'node:fs';
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

function assertJournalTracksNewestMigrations(migrationsFolder) {
  const journalPath = resolve(migrationsFolder, 'meta/_journal.json');
  const journalRaw = readFileSync(journalPath, 'utf8').replace(/^\uFEFF/, '');
  const journal = JSON.parse(journalRaw);
  const entries = Array.isArray(journal.entries) ? journal.entries : [];
  const trackedTags = new Set(entries.map((entry) => entry.tag));
  const highestTrackedIndex = entries.reduce((highest, entry) => {
    const numericPrefix = Number.parseInt(String(entry.tag ?? '').slice(0, 4), 10);
    return Number.isFinite(numericPrefix) ? Math.max(highest, numericPrefix) : highest;
  }, -1);

  const untrackedNewerFiles = readdirSync(migrationsFolder)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({
      name,
      tag: name.slice(0, -4),
      numericPrefix: Number.parseInt(name.slice(0, 4), 10),
    }))
    .filter((file) => Number.isFinite(file.numericPrefix))
    .filter((file) => file.numericPrefix > highestTrackedIndex)
    .filter((file) => !trackedTags.has(file.tag))
    .sort((left, right) => left.numericPrefix - right.numericPrefix);

  if (untrackedNewerFiles.length > 0) {
    const fileList = untrackedNewerFiles.map((file) => file.name).join(', ');
    throw new Error(
      `Migration journal is missing newer SQL files: ${fileList}. ` +
      'Update packages/db/migrations/meta/_journal.json before running migrations.',
    );
  }

  for (let index = 1; index < entries.length; index += 1) {
    const previousEntry = entries[index - 1];
    const currentEntry = entries[index];
    if (!previousEntry || !currentEntry) continue;

    if (currentEntry.idx <= previousEntry.idx) {
      throw new Error(
        `Migration journal index order is invalid near ${previousEntry.tag} -> ${currentEntry.tag}.`,
      );
    }

    if (currentEntry.when <= previousEntry.when) {
      throw new Error(
        `Migration journal timestamps must increase monotonically: ${previousEntry.tag} (${previousEntry.when}) -> ${currentEntry.tag} (${currentEntry.when}).`,
      );
    }
  }
}

try {
  const migrationsFolder = resolve(__dirname, '../migrations');
  assertJournalTracksNewestMigrations(migrationsFolder);
  await migrate(db, {
    migrationsFolder,
  });
  console.log('Migrations applied successfully.');
} finally {
  await client.end();
}
