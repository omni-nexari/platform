import postgres from 'postgres';
const sql = postgres('postgresql://ds:Samsung%402026!@localhost:5432/ds', { onnotice: ()=>{} });

// Check what migration tracking tables exist
const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname IN ('public','drizzle') AND tablename LIKE '%migr%'`;
console.log('Migration tables:', tables.map(r => r.tablename));

// Apply missing columns directly
await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS mdc_lux_value integer`;
console.log('mdc_lux_value: OK');
await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS mdc_hw_clock text`;
console.log('mdc_hw_clock: OK');

await sql.end();
