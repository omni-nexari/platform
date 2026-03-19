import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgresql://ds:Samsung%402026!@192.168.1.17:5432/ds';

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
export type DB = typeof db;

export * from './schema/index.js';
