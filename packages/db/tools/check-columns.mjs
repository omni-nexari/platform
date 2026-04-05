import postgres from 'postgres';
const sql = postgres('postgresql://ds:Samsung%402026!@localhost:5432/ds', { onnotice: ()=>{} });
const rows = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'devices' AND column_name LIKE 'mdc_%' ORDER BY column_name`;
console.log('MDC columns in DB:', rows.map(r => r.column_name));
await sql.end();
