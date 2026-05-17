/**
 * Seed a demo POS menu with 5 categories and 20 items.
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
  imageUrl: string;
  tags: string[];
  sortOrder: number;
};

const categoryData: { name: string; color: string; imageUrl: string; sortOrder: number; items: ItemSeed[] }[] = [
  {
    name: 'Burgers',
    color: '#f59e0b',
    imageUrl: 'https://images.pexels.com/photos/70497/pexels-photo-70497.jpeg?auto=compress&cs=tinysrgb&w=1200',
    sortOrder: 0,
    items: [
      {
        name: 'Classic Cheeseburger',
        description: 'Beef patty, cheddar, lettuce, tomato, pickles, house sauce',
        priceCents: 1299,
        imageUrl: 'https://images.pexels.com/photos/1639557/pexels-photo-1639557.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['popular'],
        sortOrder: 0,
      },
      {
        name: 'BBQ Bacon Burger',
        description: 'Beef patty, crispy bacon, BBQ sauce, onion rings, cheddar',
        priceCents: 1499,
        imageUrl: 'https://images.pexels.com/photos/3756523/pexels-photo-3756523.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['popular'],
        sortOrder: 1,
      },
      {
        name: 'Veggie Smash Burger',
        description: 'Black bean patty, avocado, roasted peppers, vegan mayo',
        priceCents: 1350,
        imageUrl: 'https://images.pexels.com/photos/6546026/pexels-photo-6546026.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['vegan', 'popular'],
        sortOrder: 2,
      },
      {
        name: 'Double Smash Burger',
        description: 'Two smashed beef patties, American cheese, special sauce, shredded lettuce',
        priceCents: 1699,
        imageUrl: 'https://images.pexels.com/photos/4110541/pexels-photo-4110541.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['popular'],
        sortOrder: 3,
      },
      {
        name: 'Mushroom Swiss Burger',
        description: 'Beef patty, sautéed mushrooms, Swiss cheese, garlic aioli, brioche bun',
        priceCents: 1599,
        imageUrl: 'https://images.pexels.com/photos/1251198/pexels-photo-1251198.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: [],
        sortOrder: 4,
      },
    ],
  },
  {
    name: 'Sides',
    color: '#10b981',
    imageUrl: 'https://images.pexels.com/photos/1893557/pexels-photo-1893557.jpeg?auto=compress&cs=tinysrgb&w=1200',
    sortOrder: 1,
    items: [
      {
        name: 'Seasoned Fries',
        description: 'Crispy fries with house seasoning blend',
        priceCents: 499,
        imageUrl: 'https://images.pexels.com/photos/1583884/pexels-photo-1583884.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['vegan'],
        sortOrder: 0,
      },
      {
        name: 'Onion Rings',
        description: 'Beer-battered onion rings with dipping sauce',
        priceCents: 599,
        imageUrl: 'https://images.pexels.com/photos/533325/pexels-photo-533325.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: [],
        sortOrder: 1,
      },
      {
        name: 'Coleslaw',
        description: 'Creamy house coleslaw with fresh herbs',
        priceCents: 349,
        imageUrl: 'https://images.pexels.com/photos/1640774/pexels-photo-1640774.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['gluten-free'],
        sortOrder: 2,
      },
      {
        name: 'Sweet Potato Fries',
        description: 'Oven-roasted sweet potato fries with chipotle dip',
        priceCents: 549,
        imageUrl: 'https://images.pexels.com/photos/1893555/pexels-photo-1893555.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['vegan', 'gluten-free'],
        sortOrder: 3,
      },
      {
        name: 'Mac & Cheese Bites',
        description: 'Golden-fried mac & cheese bites with ranch dip',
        priceCents: 649,
        imageUrl: 'https://images.pexels.com/photos/5908226/pexels-photo-5908226.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['popular'],
        sortOrder: 4,
      },
    ],
  },
  {
    name: 'Drinks',
    color: '#3b82f6',
    imageUrl: 'https://images.pexels.com/photos/2983101/pexels-photo-2983101.jpeg?auto=compress&cs=tinysrgb&w=1200',
    sortOrder: 2,
    items: [
      {
        name: 'Soft Drink',
        description: 'Choice of Coke, Diet Coke, Sprite, or Fanta — 500 ml',
        priceCents: 299,
        imageUrl: 'https://images.pexels.com/photos/2983101/pexels-photo-2983101.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: [],
        sortOrder: 0,
      },
      {
        name: 'Fresh Lemonade',
        description: 'House-made lemonade with mint and ginger',
        priceCents: 450,
        imageUrl: 'https://images.pexels.com/photos/96974/pexels-photo-96974.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['vegan', 'gluten-free'],
        sortOrder: 1,
      },
      {
        name: 'Iced Coffee',
        description: 'Cold brew over ice with oat milk',
        priceCents: 550,
        imageUrl: 'https://images.pexels.com/photos/312418/pexels-photo-312418.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: [],
        sortOrder: 2,
      },
      {
        name: 'Mango Smoothie',
        description: 'Blended fresh mango, banana, and coconut milk',
        priceCents: 649,
        imageUrl: 'https://images.pexels.com/photos/3512020/pexels-photo-3512020.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['vegan', 'gluten-free'],
        sortOrder: 3,
      },
      {
        name: 'Craft Milkshake',
        description: 'Thick shake — vanilla, chocolate, or strawberry',
        priceCents: 799,
        imageUrl: 'https://images.pexels.com/photos/3727250/pexels-photo-3727250.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['popular'],
        sortOrder: 4,
      },
    ],
  },
  {
    name: 'Desserts',
    color: '#ec4899',
    imageUrl: 'https://images.pexels.com/photos/1854652/pexels-photo-1854652.jpeg?auto=compress&cs=tinysrgb&w=1200',
    sortOrder: 3,
    items: [
      {
        name: 'Chocolate Brownie',
        description: 'Warm fudge brownie with vanilla ice cream',
        priceCents: 799,
        imageUrl: 'https://images.pexels.com/photos/291528/pexels-photo-291528.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['popular'],
        sortOrder: 0,
      },
      {
        name: 'New York Cheesecake',
        description: 'Creamy baked cheesecake with berry compote',
        priceCents: 849,
        imageUrl: 'https://images.pexels.com/photos/1126359/pexels-photo-1126359.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['popular'],
        sortOrder: 1,
      },
      {
        name: 'Churros & Dip',
        description: 'Cinnamon-dusted churros with warm chocolate dipping sauce',
        priceCents: 699,
        imageUrl: 'https://images.pexels.com/photos/4051893/pexels-photo-4051893.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: [],
        sortOrder: 2,
      },
    ],
  },
  {
    name: 'Starters',
    color: '#8b5cf6',
    imageUrl: 'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=1200',
    sortOrder: 4,
    items: [
      {
        name: 'Loaded Nachos',
        description: 'Tortilla chips, jalapeños, salsa, sour cream, guacamole, melted cheese',
        priceCents: 1099,
        imageUrl: 'https://images.pexels.com/photos/5737254/pexels-photo-5737254.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['popular', 'gluten-free'],
        sortOrder: 0,
      },
      {
        name: 'Chicken Wings',
        description: 'Crispy wings tossed in your choice of buffalo, BBQ, or honey garlic sauce',
        priceCents: 1199,
        imageUrl: 'https://images.pexels.com/photos/2338407/pexels-photo-2338407.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['popular', 'gluten-free'],
        sortOrder: 1,
      },
      {
        name: 'Mozzarella Sticks',
        description: 'Golden-fried mozzarella with marinara dipping sauce',
        priceCents: 849,
        imageUrl: 'https://images.pexels.com/photos/6210747/pexels-photo-6210747.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: [],
        sortOrder: 2,
      },
      {
        name: 'Garlic Bread',
        description: 'Toasted sourdough with roasted garlic butter and fresh parsley',
        priceCents: 599,
        imageUrl: 'https://images.pexels.com/photos/1760535/pexels-photo-1760535.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['vegan'],
        sortOrder: 3,
      },
      {
        name: 'Caesar Salad',
        description: 'Romaine, shaved Parmesan, house croutons, Caesar dressing',
        priceCents: 999,
        imageUrl: 'https://images.pexels.com/photos/1211887/pexels-photo-1211887.jpeg?auto=compress&cs=tinysrgb&w=1200',
        tags: ['gluten-free'],
        sortOrder: 4,
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
      imageUrl:  cat.imageUrl,
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
      imageUrl:     item.imageUrl,
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
