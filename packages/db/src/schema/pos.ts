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
import { relations } from 'drizzle-orm';
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
    // Order source: 'pos' (default), 'uber-eats', 'kiosk'
    source:       text('source').notNull().default('pos'),
    // External order ID from the originating platform (e.g. Uber Eats order UUID)
    externalId:   text('external_id'),
    completedAt:  timestamp('completed_at', { withTimezone: true }),
    cancelledAt:  timestamp('cancelled_at', { withTimezone: true }),
    createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pos_orders_workspace').on(t.workspaceId),
    index('idx_pos_orders_status').on(t.status),
    index('idx_pos_orders_created').on(t.createdAt),
    index('idx_pos_orders_external_id').on(t.externalId),
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

// ─────────────────────────────────────────────────────────────────────────────
// POS Restaurant — profile / config per workspace
// ─────────────────────────────────────────────────────────────────────────────
export const posRestaurants = pgTable(
  'pos_restaurants',
  {
    id:              uuid('id').primaryKey().defaultRandom(),
    orgId:           uuid('org_id').notNull().references(() => organisations.id),
    workspaceId:     uuid('workspace_id').notNull().references(() => workspaces.id),
    name:            text('name').notNull().default(''),
    address:         text('address'),
    phone:           text('phone'),
    email:           text('email'),
    currency:        text('currency').notNull().default('USD'),
    taxRatePct:      integer('tax_rate_pct').notNull().default(0),  // basis points, e.g. 1000 = 10%
    receiptHeader:   text('receipt_header'),   // printed at top of receipt
    receiptFooter:   text('receipt_footer'),   // printed at bottom of receipt
    businessHours:   jsonb('business_hours'),  // { mon: { open: '08:00', close: '22:00' }, ... }
    // Loyalty config stored here to avoid extra table for MVP
    loyaltyEnabled:  boolean('loyalty_enabled').notNull().default(false),
    loyaltyPointsPerDollar: integer('loyalty_points_per_dollar').notNull().default(1),
    loyaltyRedemptionRate:  integer('loyalty_redemption_rate').notNull().default(100), // points per $1 off
    settings:        jsonb('settings').$type<Record<string, unknown>>().default({}),
    createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pos_restaurants_workspace').on(t.workspaceId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// POS Tables — dining table configuration
// ─────────────────────────────────────────────────────────────────────────────
export const posTables = pgTable(
  'pos_tables',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    number:      integer('number').notNull(),   // display number, e.g. 1-20
    name:        text('name'),                  // optional label, e.g. "Window 3"
    seats:       integer('seats').notNull().default(4),
    location:    text('location'),              // zone label, e.g. "Outdoor", "Bar"
    status:      text('status').notNull().default('available'), // available | occupied | reserved
    sortOrder:   integer('sort_order').notNull().default(0),
    isActive:    boolean('is_active').notNull().default(true),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pos_tables_workspace').on(t.workspaceId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// POS Kiosk Config — workspace-level kiosk display defaults
// ─────────────────────────────────────────────────────────────────────────────
export const posKioskConfig = pgTable('pos_kiosk_config', {
  workspaceId:        uuid('workspace_id').primaryKey().references(() => workspaces.id),
  orientation:        text('orientation').notNull().default('portrait'),  // portrait | landscape
  welcomeMessage:     text('welcome_message'),
  idleTimeoutSeconds: integer('idle_timeout_seconds').notNull().default(60),
  logoUrl:            text('logo_url'),    // override workspace logo for kiosk
  qrOrderingEnabled:  boolean('qr_ordering_enabled').notNull().default(false),
  primaryColor:       text('primary_color'),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const posKitchenConfig = pgTable('pos_kitchen_config', {
  workspaceId:      uuid('workspace_id').primaryKey().references(() => workspaces.id),
  columnCount:      integer('column_count').notNull().default(3),
  soundEnabled:     boolean('sound_enabled').notNull().default(true),
  alertIntervalSec: integer('alert_interval_sec').notNull().default(30),
  theme:            text('theme').notNull().default('dark'),   // 'dark' | 'light'
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// POS Inventory Items — ingredient / product stock tracking
// ─────────────────────────────────────────────────────────────────────────────
export const posInventoryItems = pgTable(
  'pos_inventory_items',
  {
    id:            uuid('id').primaryKey().defaultRandom(),
    orgId:         uuid('org_id').notNull().references(() => organisations.id),
    workspaceId:   uuid('workspace_id').notNull().references(() => workspaces.id),
    name:          text('name').notNull(),
    sku:           text('sku'),
    unit:          text('unit').notNull().default('unit'),   // 'kg' | 'g' | 'L' | 'ml' | 'unit' | etc.
    quantity:      integer('quantity').notNull().default(0), // stored as smallest unit (e.g. grams for 'g')
    reorderPoint:  integer('reorder_point').notNull().default(0),
    costCents:     integer('cost_cents').notNull().default(0), // per unit cost
    supplier:      text('supplier'),
    notes:         text('notes'),
    isActive:      boolean('is_active').notNull().default(true),
    createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pos_inventory_workspace').on(t.workspaceId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// POS Employees — staff records (standalone, not linked to platform users for MVP)
// ─────────────────────────────────────────────────────────────────────────────
export const posEmployees = pgTable(
  'pos_employees',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    orgId:       uuid('org_id').notNull().references(() => organisations.id),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    name:        text('name').notNull(),
    email:       text('email'),
    phone:       text('phone'),
    role:        text('role').notNull().default('staff'),  // 'manager' | 'cashier' | 'kitchen' | 'staff'
    pinHash:     text('pin_hash'),   // bcrypt hash of 4-digit PIN
    isActive:    boolean('is_active').notNull().default(true),
    hiredAt:     timestamp('hired_at', { withTimezone: true }),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pos_employees_workspace').on(t.workspaceId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// POS Time Entries — employee clock-in/out records
// ─────────────────────────────────────────────────────────────────────────────
export const posTimeEntries = pgTable(
  'pos_time_entries',
  {
    id:           uuid('id').primaryKey().defaultRandom(),
    employeeId:   uuid('employee_id').notNull().references(() => posEmployees.id, { onDelete: 'cascade' }),
    workspaceId:  uuid('workspace_id').notNull().references(() => workspaces.id),
    clockedInAt:  timestamp('clocked_in_at', { withTimezone: true }).notNull().defaultNow(),
    clockedOutAt: timestamp('clocked_out_at', { withTimezone: true }),
    breakMinutes: integer('break_minutes').notNull().default(0),
    notes:        text('notes'),
    createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pos_time_entries_employee').on(t.employeeId),
    index('idx_pos_time_entries_workspace').on(t.workspaceId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// POS Loyalty Customers — loyalty programme members
// ─────────────────────────────────────────────────────────────────────────────
export const posLoyaltyCustomers = pgTable(
  'pos_loyalty_customers',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    orgId:       uuid('org_id').notNull().references(() => organisations.id),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    phone:       text('phone'),        // primary lookup key
    email:       text('email'),
    name:        text('name').notNull().default(''),
    points:      integer('points').notNull().default(0),
    tier:        text('tier').notNull().default('bronze'),  // 'bronze' | 'silver' | 'gold'
    enrolledAt:  timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pos_loyalty_workspace').on(t.workspaceId),
    index('idx_pos_loyalty_phone').on(t.phone),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// POS Loyalty Events — points earn / redeem history
// ─────────────────────────────────────────────────────────────────────────────
export const posLoyaltyEvents = pgTable(
  'pos_loyalty_events',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    customerId:  uuid('customer_id').notNull().references(() => posLoyaltyCustomers.id, { onDelete: 'cascade' }),
    orderId:     uuid('order_id').references(() => posOrders.id, { onDelete: 'set null' }),
    type:        text('type').notNull(),   // 'earn' | 'redeem' | 'adjust'
    pointsDelta: integer('points_delta').notNull(),  // positive = earn, negative = redeem
    notes:       text('notes'),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pos_loyalty_events_customer').on(t.customerId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// POS Expenses — operational expense tracking
// ─────────────────────────────────────────────────────────────────────────────
export const posExpenses = pgTable(
  'pos_expenses',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    orgId:       uuid('org_id').notNull().references(() => organisations.id),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    category:    text('category').notNull().default('other'),  // 'supplies' | 'utilities' | 'wages' | 'maintenance' | 'other'
    description: text('description').notNull(),
    amountCents: integer('amount_cents').notNull(),
    expenseDate: timestamp('expense_date', { withTimezone: true }).notNull().defaultNow(),
    receiptUrl:  text('receipt_url'),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pos_expenses_workspace').on(t.workspaceId),
    index('idx_pos_expenses_date').on(t.expenseDate),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// POS Purchase Orders — supplier purchase order management
// ─────────────────────────────────────────────────────────────────────────────
export const posPurchaseOrders = pgTable(
  'pos_purchase_orders',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    orgId:       uuid('org_id').notNull().references(() => organisations.id),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
    poNumber:    integer('po_number').notNull(),  // sequential per workspace
    supplier:    text('supplier').notNull(),
    status:      text('status').notNull().default('draft'),  // 'draft' | 'sent' | 'received' | 'cancelled'
    // Line items as JSON snapshot: [{name, quantity, unit, unitCostCents, totalCents}]
    items:       jsonb('items').$type<{
      name: string; quantity: number; unit: string; unitCostCents: number; totalCents: number;
    }[]>().default([]),
    totalCents:  integer('total_cents').notNull().default(0),
    orderedAt:   timestamp('ordered_at', { withTimezone: true }),
    expectedAt:  timestamp('expected_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    notes:       text('notes'),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pos_purchase_orders_workspace').on(t.workspaceId),
    index('idx_pos_purchase_orders_status').on(t.status),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// POS Payments — payment record per order
// ─────────────────────────────────────────────────────────────────────────────
export const posPayments = pgTable('pos_payments', {
  id:          uuid('id').primaryKey().defaultRandom(),
  orderId:     uuid('order_id').notNull().references(() => posOrders.id),
  method:      text('method').notNull().default('cash'),  // cash | card | split
  amountCents: integer('amount_cents').notNull(),
  tipCents:    integer('tip_cents').notNull().default(0),
  changeCents: integer('change_cents').notNull().default(0),
  reference:   text('reference'),   // card auth code, receipt #, etc.
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────────────────────
export const posOrdersRelations = relations(posOrders, ({ many }) => ({
  items: many(posOrderItems),
}));

export const posOrderItemsRelations = relations(posOrderItems, ({ one }) => ({
  order: one(posOrders, { fields: [posOrderItems.orderId], references: [posOrders.id] }),
}));
