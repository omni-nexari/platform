/**
 * Seed a demo POS menu with 4 categories and 10 items.
 * Usage: pnpm --filter @signage/api seed:pos
 *
 * Pass WORKSPACE_ID env var or set the default below.
 */

import { db } from '@signage/db';
import {
  workspaces,
  posMenus,
  posCategories,
  posItems,
} from '@signage/db';
import { eq } from 'drizzle-orm';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? '3e3baa54-33e4-4a2b-8835-36cee5683ead';

// ── 1. Look up workspace ──────────────────────────────────────────────────────

const [workspace] = await db
  .select()
  .from(workspaces)
  .where(eq(workspaces.id, WORKSPACE_ID))
  .limit(1);

if (!workspace) {
  console.error(`Workspace not found: ${WORKSPACE_ID}`);
  process.exit(1);
}

console.log(`Using workspace: ${workspace.name} (${workspace.id})`);

// ── 2. Deactivate any existing menus ─────────────────────────────────────────

await db
  .update(posMenus)
  .set({ isActive: false })
  .where(eq(posMenus.workspaceId, WORKSPACE_ID));

// ── 3. Create menu ────────────────────────────────────────────────────────────

const [menu] = await db
  .insert(posMenus)
  .values({
    orgId:       workspace.orgId,
    workspaceId: WORKSPACE_ID,
    name:        'Demo Menu',
    description: 'Sample menu seeded for development',
    isActive:    true,
    currency:    'USD',
  })
  .returning();

console.log(`Created menu: ${menu.name} (${menu.id})`);

// ── 4. Categories + Items ─────────────────────────────────────────────────────

type ItemSeed = {
  name: string;
  description: string;
  priceCents: number;
  tags: string[];
  sortOrder: number;
};

const categoryData: { name: string; color: string; sortOrder: number; items: ItemSeed[] }[] = [
  {
    name: 'Burgers',
    color: '#f59e0b',
    sortOrder: 0,
    items: [
      {
        name: 'Classic Cheeseburger',
        description: 'Beef patty, cheddar, lettuce, tomato, pickles, house sauce',
        priceCents: 1299,
        tags: ['popular'],
        sortOrder: 0,
      },
      {
        name: 'BBQ Bacon Burger',
        description: 'Beef patty, crispy bacon, BBQ sauce, onion rings, cheddar',
        priceCents: 1499,
        tags: ['popular'],
        sortOrder: 1,
      },
      {
        name: 'Veggie Smash Burger',
        description: 'Black bean patty, avocado, roasted peppers, vegan mayo',
        priceCents: 1350,
        tags: ['vegan', 'popular'],
        sortOrder: 2,
      },
    ],
  },
  {
    name: 'Sides',
    color: '#10b981',
    sortOrder: 1,
    items: [
      {
        name: 'Seasoned Fries',
        description: 'Crispy fries with house seasoning blend',
        priceCents: 499,
        tags: ['vegan'],
        sortOrder: 0,
      },
      {
        name: 'Onion Rings',
        description: 'Beer-battered onion rings with dipping sauce',
        priceCents: 599,
        tags: [],
        sortOrder: 1,
      },
      {
        name: 'Coleslaw',
        description: 'Creamy house coleslaw with fresh herbs',
        priceCents: 349,
        tags: ['gluten-free'],
        sortOrder: 2,
      },
    ],
  },
  {
    name: 'Drinks',
    color: '#3b82f6',
    sortOrder: 2,
    items: [
      {
        name: 'Soft Drink',
        description: 'Choice of Coke, Diet Coke, Sprite, or Fanta — 500 ml',
        priceCents: 299,
        tags: [],
        sortOrder: 0,
      },
      {
        name: 'Fresh Lemonade',
        description: 'House-made lemonade with mint and ginger',
        priceCents: 450,
        tags: ['vegan', 'gluten-free'],
        sortOrder: 1,
      },
      {
        name: 'Iced Coffee',
        description: 'Cold brew over ice with oat milk',
        priceCents: 550,
        tags: [],
        sortOrder: 2,
      },
    ],
  },
  {
    name: 'Desserts',
    color: '#ec4899',
    sortOrder: 3,
    items: [
      {
        name: 'Chocolate Brownie',
        description: 'Warm fudge brownie with vanilla ice cream',
        priceCents: 799,
        tags: ['popular'],
        sortOrder: 0,
      },
    ],
  },
];

let totalItems = 0;

for (const cat of categoryData) {
  const [category] = await db
    .insert(posCategories)
    .values({
      menuId:    menu.id,
      name:      cat.name,
      color:     cat.color,
      sortOrder: cat.sortOrder,
      isActive:  true,
    })
    .returning();

  console.log(`  Category: ${category.name} (${category.id})`);

  for (const item of cat.items) {
    await db.insert(posItems).values({
      categoryId:   category.id,
      name:         item.name,
      description:  item.description,
      priceCents:   item.priceCents,
      tags:         item.tags,
      isAvailable:  true,
      sortOrder:    item.sortOrder,
    });
    console.log(`    + ${item.name} — $${(item.priceCents / 100).toFixed(2)}`);
    totalItems++;
  }
}

console.log(`\nDone — seeded ${totalItems} items across ${categoryData.length} categories.`);
