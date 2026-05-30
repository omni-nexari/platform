import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL);
const since = new Date(Date.now() - 4 * 60 * 60 * 1000);
const devIds = ['90daa6d9-30b0-45f7-a468-34733bdcaaad','612da091-6399-4c4e-99a8-a468c5fb8a7d'];
const logs = await sql`
  SELECT created_at, level, device_id, message FROM log_entries
  WHERE device_id IN (
    '90daa6d9-30b0-45f7-a468-34733bdcaaad'::uuid,
    '612da091-6399-4c4e-99a8-a468c5fb8a7d'::uuid
  )
    AND created_at >= ${since}
  ORDER BY created_at DESC LIMIT 20
`;
console.log('QM43C + qm50 recent logs:');
for (const l of logs) console.log(`[${l.created_at.toISOString()}] [${l.level}] dev=${l.device_id.slice(0,8)} ${l.message}`);
if (!logs.length) console.log('(no logs in last 4h - devices may be offline)');
await sql.end();
