/**
 * Probe MagicInfo download endpoints to find the correct URL format.
 * Usage:
 *   node tools/probe-magicinfo-download.mjs
 *
 * Edit MAGICINFO_BASE_URL, USERNAME, PASSWORD below (or set as env vars).
 */

import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';

const BASE_URL    = process.env.MI_URL      ?? 'https://cibc.avida.ca:7002/MagicInfo';
const USERNAME    = process.env.MI_USER     ?? 'chiho';
const PASSWORD    = process.env.MI_PASS     ?? '';
const TOTP_SECRET = process.env.MI_TOTP     ?? '';

// ── TOTP (RFC 6238) ───────────────────────────────────────────────────────────

function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0;
  const result = [];
  for (const c of s.toUpperCase().replace(/=+$/, '')) {
    val = (val << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) { result.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(result);
}

function generateTotp(secret) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset+1] << 16 | hmac[offset+2] << 8 | hmac[offset+3]) % 1000000;
  return String(code).padStart(6, '0');
}

// ── helpers ──────────────────────────────────────────────────────────────────

function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: Number(parsed.port) || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: opts.method ?? 'GET',
      headers: opts.headers ?? {},
      rejectUnauthorized: false,
    };
    const r = mod.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

function base(path) {
  return `${BASE_URL.replace(/\/+$/, '')}${path}`;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!PASSWORD) {
    console.error('Set MI_PASS env var: $env:MI_PASS="your-password"; node tools/probe-magicinfo-download.mjs');
    process.exit(1);
  }

  // 1. Authenticate
  console.log('\n=== Step 1: Authenticate ===');
  const totpCode = TOTP_SECRET ? generateTotp(TOTP_SECRET) : undefined;
  if (totpCode) console.log('TOTP code:', totpCode);
  const authPayload = { grantType: 'password', username: USERNAME, password: PASSWORD, ...(totpCode ? { totp: totpCode } : {}) };
  const authBody = JSON.stringify(authPayload);
  const authRes = await req(base('/restapi/v2.0/auth'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': String(Buffer.byteLength(authBody)) },
    body: authBody,
  });
  console.log('Status:', authRes.status);
  if (authRes.status !== 200) {
    console.error('Auth failed:', authRes.body.slice(0, 300));
    process.exit(1);
  }
  const authData = JSON.parse(authRes.body);
  const token = authData.token;
  console.log('Token:', token ? token.slice(0, 20) + '...' : 'MISSING');

  const headers = { 'api_key': token, 'Accept': 'application/json' };

  // 2. List a few content items
  console.log('\n=== Step 2: List content (first 5) ===');
  const listRes = await req(base('/restapi/v2.0/cms/contents?pageSize=5&startIndex=1'), { headers });
  console.log('Status:', listRes.status);
  if (listRes.status !== 200) {
    console.error('List failed:', listRes.body.slice(0, 300));
    process.exit(1);
  }
  const listData = JSON.parse(listRes.body);
  console.log('Raw top-level keys:', Object.keys(listData));

  // Try to find items
  const items = listData.items ?? listData.data?.items ?? listData.list ?? listData.result ?? [];
  console.log(`Found ${items.length} items`);
  if (items.length === 0) {
    console.error('No items in response — raw body:\n', listRes.body.slice(0, 500));
    process.exit(1);
  }

  const first = items[0];
  console.log('\nFirst item keys:', Object.keys(first));
  console.log('First item:', JSON.stringify(first, null, 2).slice(0, 600));

  const contentId = first.contentId ?? first.id ?? first.contentSeq ?? first.seq;
  if (!contentId) {
    console.error('Could not determine content ID field!');
    process.exit(1);
  }
  console.log(`\nUsing contentId = ${contentId} (type: ${typeof contentId})`);

  // 3. Try all known download URL patterns
  console.log('\n=== Step 3: Probe download URLs ===');
  const candidates = [
    `/restapi/v2.0/cms/contents/download/${contentId}`,
    `/restapi/v2.0/cms/contents/${contentId}/download`,
    `/restapi/v2.0/cms/contents/${contentId}/file`,
    `/restapi/v2.0/cms/contents/file/${contentId}`,
    `/restapi/v2.0/cms/contents/${contentId}`,
  ];

  for (const path of candidates) {
    const url = base(path);
    try {
      const r = await req(url, { headers: { ...headers, 'Accept': '*/*' } });
      const ct = r.headers['content-type'] ?? '';
      const isFile = !ct.includes('json') && r.status === 200;
      console.log(`  ${r.status}  ${isFile ? '✓ BINARY' : '✗'}  ${path}  [${ct.slice(0, 60)}]`);
    } catch (e) {
      console.log(`  ERR  ${path}  ${e.message}`);
    }
  }

  // 4. GET detail for first item to check all fields
  console.log('\n=== Step 4: Content detail + mainFileUrl download ===');
  const detailRes = await req(base(`/restapi/v2.0/cms/contents/${contentId}`), { headers });
  console.log('Status:', detailRes.status);
  if (detailRes.status === 200) {
    const detail = JSON.parse(detailRes.body);
    const item = detail.items ?? detail;
    console.log(JSON.stringify(item, null, 2).slice(0, 800));

    // Try downloading via mainFileUrl (replace localhost with actual server)
    const rawMainUrl = item.mainFileUrl ?? '';
    if (rawMainUrl) {
      const actualMainUrl = rawMainUrl.replace(/https?:\/\/localhost:\d+/, BASE_URL.replace(/\/restapi.*$/, ''));
      console.log('\nmainFileUrl (rewritten):', actualMainUrl);
      const dlHeaders = { 'api_key': token, 'Accept': '*/*' };
      const dlRes = await req(actualMainUrl, { headers: dlHeaders });
      const ct = dlRes.headers['content-type'] ?? '';
      console.log(`Download status: ${dlRes.status}  content-type: ${ct}  bytes: ${dlRes.body.length}`);
    }

    // Also try with mainFileId
    const mainFileId = item.mainFileId;
    if (mainFileId) {
      console.log('\nmainFileId:', mainFileId);
      const fileUrl = `${BASE_URL.replace(/\/restapi.*$/, '')}/servlet/GetFileLoader?paramPathConfName=CONTENTS_HOME&filepath=${encodeURIComponent(mainFileId)}/${encodeURIComponent(item.mainFileName ?? '')}`;
      console.log('Constructed GetFileLoader URL:', fileUrl);
      const dlRes = await req(fileUrl, { headers: { 'api_key': token, 'Accept': '*/*' } });
      const ct = dlRes.headers['content-type'] ?? '';
      console.log(`Status: ${dlRes.status}  content-type: ${ct}  bytes: ${dlRes.body.length}`);
    }
  } else {
    console.log(detailRes.body.slice(0, 300));
  }

  // 5. List IMAGE/VIDEO content specifically (the failing epaper ones)
  console.log('\n=== Step 5: Find image content ===');
  const imgRes = await req(base('/restapi/v2.0/cms/contents?pageSize=10&startIndex=1&mediaType=IMAGE'), { headers });
  if (imgRes.status === 200) {
    const imgData = JSON.parse(imgRes.body);
    const imgItems = imgData.items ?? [];
    console.log(`IMAGE items found: ${imgData.totalCount ?? imgItems.length}`);
    if (imgItems[0]) {
      const img = imgItems[0];
      console.log('First image:', img.contentName, '| mainFileUrl:', img.mainFileUrl?.slice(0, 120));
      // Try rewriting the URL
      const actualUrl = img.mainFileUrl?.replace(/https?:\/\/localhost:\d+/, BASE_URL.replace(/\/restapi.*$/, ''));
      if (actualUrl) {
        const dlRes = await req(actualUrl, { headers: { 'api_key': token } });
        const ct = dlRes.headers['content-type'] ?? '';
        console.log(`Download: ${dlRes.status}  ${ct}  ${dlRes.body.length} bytes`);
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
