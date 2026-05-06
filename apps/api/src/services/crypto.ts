/**
 * AES-256-GCM symmetric encryption for at-rest secrets (OAuth tokens, ICS URLs,
 * CalDAV passwords, etc.).
 *
 * The key is loaded from `process.env.TOKEN_ENCRYPTION_KEY` and must be either:
 *   - a hex string of 64 chars (32 bytes), or
 *   - a base64 string that decodes to 32 bytes.
 *
 * Output format: `v1:<iv-b64>:<authTag-b64>:<cipher-b64>`.
 *
 * In dev/test, if the env var is missing we derive a deterministic key from a
 * placeholder so the API can still boot. We log a loud warning — production
 * deployments MUST set TOKEN_ENCRYPTION_KEY.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

let warned = false;

function loadKey(): Buffer {
  const raw = process.env['TOKEN_ENCRYPTION_KEY'];
  if (raw && raw.length > 0) {
    // hex first
    if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === KEY_BYTES * 2) {
      return Buffer.from(raw, 'hex');
    }
    // base64
    try {
      const buf = Buffer.from(raw, 'base64');
      if (buf.length === KEY_BYTES) return buf;
    } catch {
      // fall through
    }
    // last resort: hash whatever string was supplied to derive 32 bytes.
    if (!warned) {
      // eslint-disable-next-line no-console
      console.warn(
        '[crypto] TOKEN_ENCRYPTION_KEY is set but not a 32-byte hex/base64 string; '
        + 'deriving via SHA-256. Rotate to a proper key in production.',
      );
      warned = true;
    }
    return createHash('sha256').update(raw, 'utf8').digest();
  }

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is required in production. Generate one with: '
      + "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }

  if (!warned) {
    // eslint-disable-next-line no-console
    console.warn(
      '[crypto] TOKEN_ENCRYPTION_KEY not set — using DEV-ONLY fallback key. '
      + 'Calendar tokens encrypted with this key WILL NOT round-trip across deployments.',
    );
    warned = true;
  }
  return createHash('sha256').update('dev-only-fallback-do-not-use-in-prod', 'utf8').digest();
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!cachedKey) cachedKey = loadKey();
  return cachedKey;
}

export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === '') return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (payload == null || payload === '') return null;
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Encrypted payload format invalid');
  }
  const iv = Buffer.from(parts[1]!, 'base64');
  const tag = Buffer.from(parts[2]!, 'base64');
  const ct = Buffer.from(parts[3]!, 'base64');
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString('utf8');
}
