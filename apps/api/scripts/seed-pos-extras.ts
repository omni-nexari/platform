/**
 * Seed 10 loyalty customers, 10 employees, and 10 inventory items.
 * Usage: pnpm --filter @signage/api seed:pos-extras
 *
 * Pass WORKSPACE_ID env var or uses the default below.
 */

import * as argon2 from 'argon2';
import { db } from '@signage/db';
import {
  workspaces,
  posLoyaltyCustomers,
  posEmployees,
  posInventoryItems,
} from '@signage/db';
import { eq } from 'drizzle-orm';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? '3e3baa54-33e4-4a2b-8835-36cee5683ead';

// ── Workspace lookup ──────────────────────────────────────────────────────────

const [workspace] = await db
  .select()
  .from(workspaces)
  .where(eq(workspaces.id, WORKSPACE_ID))
  .limit(1);

if (!workspace) {
  console.error(`Workspace not found: ${WORKSPACE_ID}`);
  process.exit(1);
}

const orgId = workspace.orgId;
console.log(`Using workspace: ${workspace.name} (${WORKSPACE_ID})\n`);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Loyalty Customers
// ─────────────────────────────────────────────────────────────────────────────

const loyaltyData = [
  { name: 'Alice Johnson',   phone: '+1-555-0101', email: 'alice@example.com',   points: 1240, tier: 'gold'   },
  { name: 'Bob Martinez',    phone: '+1-555-0102', email: 'bob@example.com',     points:  870, tier: 'silver' },
  { name: 'Carol Lee',       phone: '+1-555-0103', email: 'carol@example.com',   points:  540, tier: 'silver' },
  { name: 'David Kim',       phone: '+1-555-0104', email: 'david@example.com',   points:  310, tier: 'bronze' },
  { name: 'Emily Chen',      phone: '+1-555-0105', email: 'emily@example.com',   points: 2050, tier: 'gold'   },
  { name: 'Frank Nguyen',    phone: '+1-555-0106', email: 'frank@example.com',   points:  150, tier: 'bronze' },
  { name: 'Grace Patel',     phone: '+1-555-0107', email: 'grace@example.com',   points:  720, tier: 'silver' },
  { name: 'Henry Okafor',    phone: '+1-555-0108', email: 'henry@example.com',   points:   80, tier: 'bronze' },
  { name: 'Isabelle Dupont', phone: '+1-555-0109', email: 'isabelle@example.com',points:  430, tier: 'bronze' },
  { name: 'James Wu',        phone: '+1-555-0110', email: 'james@example.com',   points: 1680, tier: 'gold'   },
];

console.log('Seeding loyalty customers…');
for (const c of loyaltyData) {
  const [row] = await db
    .insert(posLoyaltyCustomers)
    .values({ orgId, workspaceId: WORKSPACE_ID, ...c })
    .onConflictDoNothing()
    .returning();
  console.log(`  + ${c.name} — ${c.points} pts (${c.tier})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Employees  (PIN: 1234 for all demo accounts)
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_PIN = '1234';
const pinHash = await argon2.hash(DEMO_PIN);

const employeeData = [
  { name: 'Sarah Mitchell',  email: 'sarah@demopos.local',  phone: '+1-555-0201', role: 'manager',  hiredAt: new Date('2023-01-15') },
  { name: 'Tom Reynolds',    email: 'tom@demopos.local',    phone: '+1-555-0202', role: 'cashier',  hiredAt: new Date('2023-03-01') },
  { name: 'Priya Sharma',    email: 'priya@demopos.local',  phone: '+1-555-0203', role: 'kitchen',  hiredAt: new Date('2023-05-20') },
  { name: 'Marcus Webb',     email: 'marcus@demopos.local', phone: '+1-555-0204', role: 'cashier',  hiredAt: new Date('2023-07-11') },
  { name: 'Lena Fischer',    email: 'lena@demopos.local',   phone: '+1-555-0205', role: 'kitchen',  hiredAt: new Date('2023-09-03') },
  { name: 'Omar Hassan',     email: 'omar@demopos.local',   phone: '+1-555-0206', role: 'staff',    hiredAt: new Date('2024-01-08') },
  { name: 'Yuki Tanaka',     email: 'yuki@demopos.local',   phone: '+1-555-0207', role: 'cashier',  hiredAt: new Date('2024-02-14') },
  { name: 'Chloe Bernard',   email: 'chloe@demopos.local',  phone: '+1-555-0208', role: 'staff',    hiredAt: new Date('2024-04-22') },
  { name: 'Raj Anand',       email: 'raj@demopos.local',    phone: '+1-555-0209', role: 'kitchen',  hiredAt: new Date('2024-06-17') },
  { name: 'Nina Kowalski',   email: 'nina@demopos.local',   phone: '+1-555-0210', role: 'manager',  hiredAt: new Date('2022-11-30') },
];

console.log('\nSeeding employees (PIN: 1234)…');
for (const e of employeeData) {
  await db
    .insert(posEmployees)
    .values({ orgId, workspaceId: WORKSPACE_ID, pinHash, isActive: true, ...e })
    .onConflictDoNothing();
  console.log(`  + ${e.name} — ${e.role}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Inventory Items
// ─────────────────────────────────────────────────────────────────────────────

const inventoryData = [
  { name: 'Ground Beef',        sku: 'INV-001', unit: 'g',    quantity: 15000, reorderPoint: 3000,  costCents:  180, supplier: 'Prime Meats Co.',    notes: 'Frozen; thaw daily' },
  { name: 'Burger Buns',        sku: 'INV-002', unit: 'unit', quantity:   120, reorderPoint:   30,  costCents:   40, supplier: 'City Bakery',        notes: 'Sesame-topped' },
  { name: 'Cheddar Slices',     sku: 'INV-003', unit: 'unit', quantity:   200, reorderPoint:   50,  costCents:   25, supplier: 'Daily Dairy',        notes: null },
  { name: 'Iceberg Lettuce',    sku: 'INV-004', unit: 'g',    quantity:  4000, reorderPoint:  800,  costCents:    8, supplier: 'Green Farm Produce', notes: 'Refrigerate at 4°C' },
  { name: 'Tomatoes',           sku: 'INV-005', unit: 'g',    quantity:  5000, reorderPoint: 1000,  costCents:    6, supplier: 'Green Farm Produce', notes: null },
  { name: 'Russet Potatoes',    sku: 'INV-006', unit: 'g',    quantity: 20000, reorderPoint: 5000,  costCents:    4, supplier: 'Green Farm Produce', notes: 'For fries' },
  { name: 'Frying Oil',         sku: 'INV-007', unit: 'ml',   quantity: 10000, reorderPoint: 2000,  costCents:    5, supplier: 'BulkOil Ltd.',       notes: 'Change every 3 days' },
  { name: 'Soft Drink Syrup',   sku: 'INV-008', unit: 'ml',   quantity:  8000, reorderPoint: 2000,  costCents:   12, supplier: 'BevCo Supplies',     notes: 'CO2 canisters separate' },
  { name: 'Bacon Strips',       sku: 'INV-009', unit: 'g',    quantity:  3000, reorderPoint:  600,  costCents:  220, supplier: 'Prime Meats Co.',    notes: null },
  { name: 'Chocolate Brownie Mix', sku: 'INV-010', unit: 'g', quantity:  5000, reorderPoint: 1000,  costCents:   30, supplier: 'Sweet Supplies',     notes: 'Pre-mix; add eggs + butter' },
];

console.log('\nSeeding inventory items…');
for (const item of inventoryData) {
  await db
    .insert(posInventoryItems)
    .values({ orgId, workspaceId: WORKSPACE_ID, isActive: true, ...item })
    .onConflictDoNothing();
  console.log(`  + ${item.name} — ${item.quantity} ${item.unit} (reorder @ ${item.reorderPoint})`);
}

console.log('\nDone — seeded 10 loyalty customers, 10 employees, 10 inventory items.');
