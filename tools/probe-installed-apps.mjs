import postgres from 'file:///C:/Users/chiho/Projects/Platform/node_modules/.pnpm/postgres@3.4.8/node_modules/postgres/src/index.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve('apps/api/.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);
const sql = postgres(env.DATABASE_URL);

const colCheck = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='devices' AND column_name='installed_apps'`;
console.log('installed_apps column exists:', colCheck.length > 0);

const rows = await sql`SELECT name, installed_apps FROM devices WHERE installed_apps IS NOT NULL LIMIT 1`;
if (!rows.length) {
  console.log('No installed_apps data yet — TV needs to reconnect to send the list.');
} else {
  const { name, installed_apps: apps } = rows[0];
  console.log(`Device: ${name}   Total apps: ${apps.length}\n`);
  const shown = apps.filter(a => a.show);
  const hidden = apps.filter(a => !a.show);
  console.log(`=== show:true (${shown.length}) ===`);
  shown.forEach(a => console.log(`  ${String(a.id).padEnd(35)} | ${a.name}`));
  console.log(`\n=== show:false sample (first 15) ===`);
  hidden.slice(0, 15).forEach(a => console.log(`  ${String(a.id).padEnd(35)} | ${a.name}`));
}
await sql.end();
