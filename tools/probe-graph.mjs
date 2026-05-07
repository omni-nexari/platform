// Local decrypt + Graph probe.
import crypto from 'node:crypto';
import fs from 'node:fs';

const KEY_HEX = '8f696efac9373c91a9936449e1673ed9bf2598cc8acb89532cec2a95588ee613';
const enc = fs.readFileSync('C:/Users/chiho/AppData/Local/Temp/enc_token.txt', 'utf8').trim();

function decryptSecret(payload) {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('bad payload');
  const iv  = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct  = Buffer.from(parts[3], 'base64');
  const key = Buffer.from(KEY_HEX, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

const token = decryptSecret(enc);
console.log('Token length:', token.length);
console.log('First 30:', token.slice(0,30));

// JWT inspect
const parts = token.split('.');
if (parts.length === 3) {
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  console.log('JWT payload:');
  console.log('  iss:', payload.iss);
  console.log('  aud:', payload.aud);
  console.log('  scp:', payload.scp);
  console.log('  roles:', payload.roles);
  console.log('  tid:', payload.tid);
  console.log('  upn:', payload.upn || payload.unique_name || payload.preferred_username);
  console.log('  appid:', payload.appid);
  console.log('  exp:', new Date(payload.exp * 1000).toISOString());
  console.log('  iat:', new Date(payload.iat * 1000).toISOString());
} else {
  console.log('Not JWT format');
}

const headers = { Authorization: `Bearer ${token}` };

console.log('\n=== /me/calendars ===');
let r = await fetch('https://graph.microsoft.com/v1.0/me/calendars?$top=3', { headers });
console.log('status:', r.status);
console.log('www-authenticate:', r.headers.get('www-authenticate'));
console.log('body:', (await r.text()).slice(0, 600));

console.log('\n=== /me/calendarView (with Prefer) ===');
const from = new Date().toISOString();
const to   = new Date(Date.now() + 7*86_400_000).toISOString();
const url  = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${from}&endDateTime=${to}&$top=5`;
r = await fetch(url, { headers: { ...headers, Prefer: 'outlook.timezone="UTC"' } });
console.log('status:', r.status);
console.log('www-authenticate:', r.headers.get('www-authenticate'));
console.log('client-request-id:', r.headers.get('client-request-id'));
console.log('body:', (await r.text()).slice(0, 800));

console.log('\n=== /me/calendarView (no Prefer) ===');
r = await fetch(url, { headers });
console.log('status:', r.status);
console.log('www-authenticate:', r.headers.get('www-authenticate'));
console.log('body:', (await r.text()).slice(0, 800));

console.log('\n=== /me/events (alternate) ===');
r = await fetch('https://graph.microsoft.com/v1.0/me/events?$top=3', { headers });
console.log('status:', r.status);
console.log('body:', (await r.text()).slice(0, 600));
