import postgres from 'postgres';

const sql = postgres('postgresql://ds:Samsung%402026!@192.168.1.17:5432/ds');

const rows = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'canvas_projects' ORDER BY ordinal_position`;
console.log('canvas_projects columns:', JSON.stringify(rows, null, 2));
await sql.end();
