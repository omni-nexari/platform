import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://ds:Samsung%402026!@192.168.1.17:5432/ds',
  },
  verbose: true,
  strict: true,
});
