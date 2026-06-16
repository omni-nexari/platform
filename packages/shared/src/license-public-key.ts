/**
 * Nexari license public key (Ed25519 / SPKI PEM).
 * Used to verify offline .lic certificates locally — no network needed.
 *
 * The matching private key lives only in nexari-admin's NEXARI_LICENSE_PRIVATE_KEY env var.
 * Rotate: generate a new keypair, ship new public key here with an incremented kid,
 * keep the old public key around until all old certs have expired.
 */
export const NEXARI_LICENSE_PUBLIC_KEYS: Record<string, string> = {
  'nexari-2026-01': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAuV+W7E0svDR9IVWN/oOai8L18XFxympPrH5/ODk6nK8=
-----END PUBLIC KEY-----`,
};
