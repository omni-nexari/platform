// Debug script: load microsoft connection from DB, decrypt token, hit Graph
// /me/calendars and /me/calendarView, print full response details for both.
import pg from 'pg';
import crypto from 'node:crypto';

const CONN_ID = process.argv[2];
if (!CONN_ID) {
  console.error('Usage: node debug-ms-calendarview.mjs <connectionId>');
  process.exit(1);
}

const KEY = process.env.TOKEN_ENCRYPTION_KEY;
if (!KEY) { console.error('Missing TOKEN_ENCRYPTION_KEY'); process.exit(1); }

function decryptSecret(payload) {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('bad payload');
  const iv  = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct  = Buffer.from(parts[3], 'base64');
  const key = Buffer.from(KEY, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

const client = new pg.Client({
  host: 'localhost', user: 'signage', database: 'ds',
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
});
await client.connect();
const r = await client.query(
  `SELECT access_token_enc, refresh_token_enc, scopes, token_expires_at FROM calendar_connections WHERE id=$1`,
  [CONN_ID],
);
await client.end();
if (!r.rows[0]) { console.error('No row'); process.exit(1); }
const row = r.rows[0];
console.log('scopes:', row.scopes);
console.log('expires:', row.token_expires_at);
const token = decryptSecret(row.access_token_enc);
console.log('token (first 30):', token.slice(0, 30) + '...');

// Decode JWT payload
const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
console.log('JWT scp:', payload.scp);
console.log('JWT aud:', payload.aud);
console.log('JWT roles:', payload.roles);
console.log('JWT tid:', payload.tid);
console.log('JWT upn:', payload.upn || payload.unique_name || payload.preferred_username);

const headers = { Authorization: `Bearer ${token}` };

console.log('\n=== /me/calendars ===');
const a = await fetch('https://graph.microsoft.com/v1.0/me/calendars?$top=5', { headers });
console.log('status:', a.status);
console.log('body:', (await a.text()).slice(0, 500));

console.log('\n=== /me/calendarView ===');
const from = new Date().toISOString();
const to = new Date(Date.now() + 7*86_400_000).toISOString();
const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${from}&endDateTime=${to}&$top=5`;
const b = await fetch(url, { headers: { ...headers, Prefer: 'outlook.timezone="UTC"' } });
console.log('status:', b.status);
console.log('headers:', Object.fromEntries(b.headers.entries()));
console.log('body:', (await b.text()).slice(0, 1000));

console.log('\n=== /me/calendarView (no Prefer) ===');
const c = await fetch(url, { headers });
console.log('status:', c.status);
console.log('body:', (await c.text()).slice(0, 1000));
