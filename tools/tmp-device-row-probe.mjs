import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL);
const deviceId = '95905235-51b4-4887-9707-d0796eb287bd';
const rows = await sql`
  select id, published_content_id, published_playlist_id, published_schedule_id, default_playlist_id
  from devices
  where id = ${deviceId}
`;
console.log(JSON.stringify(rows, null, 2));
await sql.end();
