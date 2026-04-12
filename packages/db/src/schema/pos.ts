import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { organisations } from './auth.js';
import { workspaces } from './workspaces.js';
import { devices } from './devices.js';

// ─────────────────────────────────────────────────────────────────────────────
// POS Menus — one active menu per workspace
// ─────────────────────────────────────────────────────────────────────────────
export const posMenus = pgTable(
  'pos_menus',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    orgId:       uuid('org_id').notNull().references(() => organisations.id),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name:        text('name').notNull(),
    description: text('description'),
    isActive:    boolean('is_active').notNull().default(true),
    currency:    text('currency').notNull().default('USD'), // ISO 4217
    deletedAt:   timestamp('deleted_at', { withTimezone: true }),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pos_menus_workspace').on(t.workspaceId),
    index('idx_pos_menus_org').on(t.orgId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// POS Categories — grouped sections within a menu (e.g. Burgers, Drinks)
// ─────────────────────────────────────────────────────────────────────────────
export const posCategories = pgTable(
  'pos_categories',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    menuId:      uuid('menu_id').notNull().references(() => posMenus.id, { onDelete: 'cascade' }),
    name:        text('name').notNull(),
    description: text('description'),
    imageUrl:    text('image_url'),
    color:       text('color'),        // optional accent colour for kiosk UI
    sortOrder:   integer('sort_order').notNull().default(0),
    isActive:    boolean('is_active').notNull().default(true),
    deletedAt:   timestamp('deleted_at', { withTimezone: true }),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_pos_categories_menu').on(t.menuId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// POS Items — individual menu items with price
// ─────────────────────────────────────────────────────────────────────────────
export const posItems = pgTable(
  'pos_items',
  {
    id:           uuid('id').primaryKey().defaultRandom(),
    categoryId:   uuid('category_id').notNull().references(() => posCategories.id, { onDelete: 'cascade' }),
    name:         text('name').notNull(),
    description:  text('description'),
    imageUrl:     text('image_url'),
    // Price stored as INTEGER cents (e.g. 1099 = $10.99) to avoid float issues
    priceCents:   integer('price_cents').notNull().default(0),
    isAvailable:  boolean('is_available').notNull().default(true),
    sortOrder:    integer('sort_order').notNull().default(0),
    // Freeform tags: ["vegan", "gluten-free", "spicy", "popular"]
    tags:         jsonb('tags').$type<string[]>().default([]),
    // Modifier groups as JSON for now (upsell / add-on options)
    modifiers:    jsonb('modifiers').$type<{
      id: string;
      name: string;
      required: boolean;
      maxSelect: number;
      options: { id: string; name: string; priceCents: number }[];
    }[]>().default([]),
    deletedAt:    timestamp('deleted_at', { withTimezone: true }),
    createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_pos_items_category').on(t.categoryId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// POS Orders — customer orders placed at a kiosk device
// ─────────────────────────────────────────────────────────────────────────────
export const posOrders = pgTable(
  'pos_orders',
  {
    id:           uuid('id').primaryKey().defaultRandom(),
    orgId:        uuid('org_id').notNull().references(() => organisations.id),
    workspaceId:  uuid('workspace_id').notNull().references(() => workspaces.id),
    // Which kiosk device placed the order (nullable — could be manual entry)
    deviceId:     uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    // Human-readable sequential number per workspace, e.g. "#042"
    orderNumber:  integer('order_number').notNull(),
    // pending | preparing | ready | completed | cancelled
    status:       text('status').notNull().default('pending'),
    // Total in cents (sum of items × prices at order time)
    totalCents:   integer('total_cents').notNull().default(0),
    // Optional customer name (typed at kiosk)
    customerName: text('customer_name'),
    // Free-text notes from the customer
    notes:        text('notes'),
    completedAt:  timestamp('completed_at', { withTimezone: true }),
    cancelledAt:  timestamp('cancelled_at', { withTimezone: true }),
    createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pos_orders_workspace').on(t.workspaceId),
    index('idx_pos_orders_status').on(t.status),
    index('idx_pos_orders_created').on(t.createdAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// POS Order Items — line items within an order (price snapshot at order time)
// ─────────────────────────────────────────────────────────────────────────────
export const posOrderItems = pgTable(
  'pos_order_items',
  {
    id:              uuid('id').primaryKey().defaultRandom(),
    orderId:         uuid('order_id').notNull().references(() => posOrders.id, { onDelete: 'cascade' }),
    // Snapshot of the item at order time (item may be deleted/modified later)
    itemId:          uuid('item_id').references(() => posItems.id, { onDelete: 'set null' }),
    itemName:        text('item_name').notNull(),      // snapshot
    itemPriceCents:  integer('item_price_cents').notNull(), // snapshot
    quantity:        integer('quantity').notNull().default(1),
    notes:           text('notes'),                   // e.g. "no onions"
    // Selected modifier options as JSON snapshot
    selectedModifiers: jsonb('selected_modifiers').$type<{
      groupName: string;
      optionName: string;
      priceCents: number;
    }[]>().default([]),
    // Line total = (itemPriceCents + sum(modifiers)) × quantity
    lineTotalCents:  integer('line_total_cents').notNull().default(0),
    createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_pos_order_items_order').on(t.orderId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// POS Order Sequence — per-workspace counter for human-readable order numbers
// ─────────────────────────────────────────────────────────────────────────────
export const posOrderSequences = pgTable('pos_order_sequences', {
  workspaceId:   uuid('workspace_id').primaryKey().references(() => workspaces.id),
  lastOrderNumber: integer('last_order_number').notNull().default(0),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
