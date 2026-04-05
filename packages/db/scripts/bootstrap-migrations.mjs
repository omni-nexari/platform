/**
 * One-time script: seeds the drizzle.`__drizzle_migrations` tracking table
 * for a database whose schema was set up without running drizzle migrate()
 * (e.g. via drizzle-kit push or manual SQL).
 *
 * Run once:  node packages/db/scripts/bootstrap-migrations.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../migrations');

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgresql://ds:Samsung%402026!@localhost:5432/ds';

const sql = postgres(connectionString, { onnotice: () => {} });

// Read journal
const journal = JSON.parse(
  fs.readFileSync(`${migrationsFolder}/meta/_journal.json`, 'utf8')
);

// Compute hash for last migration only (drizzle only needs the latest timestamp)
const lastEntry = journal.entries.at(-1);
const lastSql = fs.readFileSync(
  `${migrationsFolder}/${lastEntry.tag}.sql`,
  'utf8'
);
const lastHash = crypto.createHash('sha256').update(lastSql).digest('hex');

try {
  // Create schema + table matching drizzle's exact DDL
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;

  // Find which milestones are already recorded
  const existing = await sql`
    SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at
  `;
  const recordedTimestamps = new Set(existing.map((r) => Number(r.created_at)));

  const missing = journal.entries.filter((e) => !recordedTimestamps.has(e.when));
  if (missing.length === 0) {
    console.log('drizzle.__drizzle_migrations is fully up to date — nothing to do.');
  } else {
    for (const entry of missing) {
      const content = fs.readFileSync(
        `${migrationsFolder}/${entry.tag}.sql`,
        'utf8'
      );
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      await sql`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${hash}, ${entry.when})
      `;
      console.log(`  + ${entry.tag}`);
    }
    console.log(`Inserted ${missing.length} missing migration record(s).`);
  }
} finally {
  await sql.end();
}
