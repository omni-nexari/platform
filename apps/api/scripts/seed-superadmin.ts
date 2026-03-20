/**
 * Seed a super admin user.
 * Usage: pnpm --filter @signage/api seed:sa
 *
 * Reads SUPERADMIN_EMAIL / SUPERADMIN_PASS / SUPERADMIN_NAME from .env,
 * falling back to sensible defaults so you can run it without any env tweaks.
 */

import * as argon2 from 'argon2';
import { db, platformOwners } from '@signage/db';
import { eq } from 'drizzle-orm';

const email = process.env.SUPERADMIN_EMAIL ?? 'admin@platform.local';
const password = process.env.SUPERADMIN_PASS ?? 'Admin@1234!';
const name = process.env.SUPERADMIN_NAME ?? 'Platform Admin';

const existing = await db
  .select({ id: platformOwners.id })
  .from(platformOwners)
  .where(eq(platformOwners.email, email))
  .limit(1);

if (existing.length > 0) {
  console.log(`Super admin already exists: ${email}`);
  process.exit(0);
}

const passwordHash = await argon2.hash(password);

await db.insert(platformOwners).values({ email, passwordHash, name });

console.log('Super admin seeded successfully');
console.log(`  Email   : ${email}`);
console.log(`  Password: ${password}`);
console.log('Change the password after first login!');
process.exit(0);
