import type { FastifyInstance } from 'fastify';
import { and, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import * as uberEatsLib from '../lib/uber-eats.js';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { getLicenseHmacSecret } from '../services/license-client.js';
import {
  db,
  posMenus,
  posCategories,
  posItems,
  posOrders,
  posOrderItems,
  posOrderSequences,
  posPayments,
  posRestaurants,
  posTables,
  posKioskConfig,
  posKitchenConfig,
  posInventoryItems,
  posEmployees,
  posTimeEntries,
  posLoyaltyCustomers,
  posLoyaltyEvents,
  posExpenses,
  posPurchaseOrders,
  posMenuSchedules,
  devices,
  deviceHeartbeats,
  workspaces,
} from '@signage/db';
import { sendCommand } from '../services/ws.js';
import { canUsePOS } from '../services/license-client.js';

// ─── Helper: notify POS display devices when config changes ─────────────────
async function notifyPosDevices(orgId: string, workspaceId: string, displayTypes: string[]): Promise<void> {
  const orgDevices = await db.query.devices.findMany({
    where: and(eq(devices.orgId, orgId), eq(devices.workspaceId, workspaceId), isNull(devices.deletedAt)),
    columns: { id: true, settings: true },
  });
  for (const d of orgDevices) {
    try {
      const s = JSON.parse(d.settings || '{}') as { posDisplayType?: string; posWorkspaceId?: string };
      if (displayTypes.includes(s.posDisplayType ?? '') && s.posWorkspaceId === workspaceId) {
        sendCommand(d.id, { type: 'refresh_schedule' });
      }
    } catch { /* ignore */ }
  }
}
function authenticateDeviceRequest(
  req: { headers: Record<string, string | string[] | undefined>; query: unknown },
  reply: { status: (n: number) => { send: (b: unknown) => void } },
  app: FastifyInstance,
): { deviceId: string; orgId: string; workspaceId: string } | null {
  const authHeader = req.headers['authorization'];
  const xHeader    = req.headers['x-device-token'];
  // Accept Bearer token OR X-Device-Token header OR ?token= query param
  const token =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : typeof xHeader === 'string'
        ? xHeader
        : (req.query as Record<string, string | undefined>).token;

  if (!token) {
    reply.status(401).send({ error: 'Missing device token' });
    return null;
  }
  try {
    const p = app.jwt.verify<{ sub: string; type: string; orgId: string; workspaceId: string }>(token);
    if (p.type !== 'device') {
      reply.status(403).send({ error: 'Invalid token type' });
      return null;
    }
    return { deviceId: p.sub, orgId: p.orgId, workspaceId: p.workspaceId };
  } catch {
    reply.status(401).send({ error: 'Invalid or expired device token' });
    return null;
  }
}

// ─── Combined kiosk / display request authentication ────────────────────────
// Accepts both hardware device JWTs (type: 'device') and display-screen JWTs (type: 'display').
// Used for kiosk-facing routes that must work for both token kinds.
function authenticateKioskOrDisplayRequest(
  req: { headers: Record<string, string | string[] | undefined>; query: unknown },
  reply: { status: (n: number) => { send: (b: unknown) => void } },
  app: FastifyInstance,
): { orgId: string; workspaceId: string } | null {
  // 1. Try display token (X-Display-Token header OR ?dt= query param)
  const xDisplayHeader = req.headers['x-display-token'];
  const dtParam = (req.query as Record<string, string | undefined>).dt;
  const displayToken = typeof xDisplayHeader === 'string' ? xDisplayHeader : dtParam;

  if (displayToken) {
    try {
      const p = app.jwt.verify<{ type: string; orgId: string; workspaceId: string }>(displayToken);
      if (p.type === 'display') return { orgId: p.orgId, workspaceId: p.workspaceId };
    } catch { /* fall through to device token */ }
  }

  // 2. Fall back to device token (Authorization Bearer / X-Device-Token / ?token= query param)
  const authHeader = req.headers['authorization'];
  const xDeviceHeader = req.headers['x-device-token'];
  const deviceToken =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : typeof xDeviceHeader === 'string'
        ? xDeviceHeader
        : (req.query as Record<string, string | undefined>).token;

  if (!deviceToken) {
    reply.status(401).send({ error: 'Missing kiosk token' });
    return null;
  }
  try {
    const p = app.jwt.verify<{ sub: string; type: string; orgId: string; workspaceId: string }>(deviceToken);
    if (p.type !== 'device') {
      reply.status(403).send({ error: 'Invalid token type' });
      return null;
    }
    return { orgId: p.orgId, workspaceId: p.workspaceId };
  } catch {
    reply.status(401).send({ error: 'Invalid or expired token' });
    return null;
  }
}

// ─── Display token helper (kiosk / kitchen public display JWT) ─────────────────
function authenticateDisplayRequest(
  req: { headers: Record<string, string | string[] | undefined>; query: unknown },
  reply: { status: (n: number) => { send: (b: unknown) => void } },
  app: FastifyInstance,
): { workspaceId: string; orgId: string; displayType: string } | null {
  const xHeader = req.headers['x-display-token'];
  const token =
    typeof xHeader === 'string'
      ? xHeader
      : (req.query as Record<string, string | undefined>).dt;

  if (!token) {
    reply.status(401).send({ error: 'Missing display token' });
    return null;
  }
  try {
    const p = app.jwt.verify<{ sub: string; type: string; displayType: string; orgId: string; workspaceId: string }>(token);
    if (p.type !== 'display') {
      reply.status(403).send({ error: 'Invalid token type' });
      return null;
    }
    return { workspaceId: p.workspaceId, orgId: p.orgId, displayType: p.displayType };
  } catch {
    reply.status(401).send({ error: 'Invalid or expired display token' });
    return null;
  }
}

// ─── Schemas ────────────────────────────────────────────────────────────────────
const OrderItemInputSchema = z.object({
  itemId:            z.string().uuid(),
  quantity:          z.number().int().min(1).max(99),
  notes:             z.string().max(200).optional().default(''),
  selectedModifiers: z.array(z.object({
    groupName:   z.string(),
    optionName:  z.string(),
    priceCents:  z.number().int().min(0),
  })).optional().default([]),
});

const CreateOrderSchema = z.object({
  workspaceId:  z.string().uuid().optional(), // ignored server-side; taken from token
  customerName: z.string().max(80).nullable().optional(),
  notes:        z.string().max(500).nullable().optional(),
  items:        z.array(OrderItemInputSchema).min(1).max(50),
});

const UpdateOrderStatusSchema = z.object({
  status: z.enum(['preparing', 'ready', 'completed', 'cancelled']),
});

const AddOrderItemsSchema = z.object({
  items: z.array(OrderItemInputSchema).min(1).max(25),
});

const MarkOrderPaidSchema = z.object({
  method: z.enum(['cash', 'card', 'split']).default('cash'),
  amountCents: z.number().int().min(0).optional(),
  tipCents: z.number().int().min(0).default(0),
  taxCents: z.number().int().min(0).default(0),
  reference: z.string().max(100).optional(),
  loyaltyCustomerId: z.string().uuid().optional(),
});

const UpdateStoreStatusSchema = z.object({
  workspaceId: z.string().uuid(),
  isOpen: z.boolean(),
  note: z.string().max(200).nullable().optional(),
});

const UpdateTodaysSpecialSchema = z.object({
  workspaceId: z.string().uuid(),
  itemId: z.string().uuid().optional(),
  name: z.string().max(120).optional(),
  description: z.string().max(400).nullable().optional(),
  priceCents: z.number().int().min(0).optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  endsAt: z.string().optional(),
});

const KioskLoyaltyVerifySchema = z.object({
  workspaceId: z.string().uuid(),
  phone: z.string().min(3).optional(),
  email: z.string().email().optional(),
}).refine((value) => Boolean(value.phone || value.email), {
  message: 'phone or email required',
});

const KioskLoyaltyRedeemSchema = z.object({
  workspaceId: z.string().uuid(),
  customerId: z.string().uuid(),
  points: z.number().int().positive(),
  orderId: z.string().uuid().optional(),
  notes: z.string().max(200).optional(),
});

const DisplayTokenTypeSchema = z.object({
  displayType: z.enum(['kiosk', 'kitchen']),
  workspaceId: z.string().uuid(),
});

const VALID_ACTIVE_STATUSES = ['pending', 'preparing', 'ready'] as const;

// ─── Route plugin ───────────────────────────────────────────────────────────────
const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';

export async function posRoutes(app: FastifyInstance) {
  // Gate all authenticated management endpoints on the POS license module
  app.addHook('preHandler', async (req, reply) => {
    if ((req.url as string).includes('/mgmt/') && !canUsePOS()) {
      return reply.status(403).send({
        error: 'license_feature_unavailable',
        message: 'POS / menu board features require a license with the POS module.',
        feature: 'pos',
      });
    }
  });

  function createHttpError(statusCode: number, message: string) {
    const error = new Error(message) as Error & { statusCode: number };
    error.statusCode = statusCode;
    return error;
  }

  function getSettingsObject(value: unknown): Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  }

  async function getLoyaltyConfig(workspaceId: string, orgId?: string) {
    const restaurant = await db.query.posRestaurants.findFirst({
      where: orgId
        ? and(eq(posRestaurants.workspaceId, workspaceId), eq(posRestaurants.orgId, orgId))
        : eq(posRestaurants.workspaceId, workspaceId),
      columns: {
        loyaltyEnabled: true,
        loyaltyPointsPerDollar: true,
        loyaltyRedemptionRate: true,
      },
    });

    return {
      loyaltyEnabled: restaurant?.loyaltyEnabled ?? false,
      loyaltyPointsPerDollar: restaurant?.loyaltyPointsPerDollar ?? 1,
      loyaltyRedemptionRate: restaurant?.loyaltyRedemptionRate ?? 100,
    };
  }

  async function findLoyaltyCustomerByContact(
    workspaceId: string,
    orgId: string,
    contact: { phone?: string | undefined; email?: string | undefined },
  ) {
    const customers = await db.query.posLoyaltyCustomers.findMany({
      where: and(eq(posLoyaltyCustomers.workspaceId, workspaceId), eq(posLoyaltyCustomers.orgId, orgId)),
      limit: 250,
    });

    return customers.find((entry) => {
      const phoneMatch = contact.phone ? entry.phone === contact.phone : false;
      const emailMatch = contact.email ? entry.email?.toLowerCase() === contact.email.toLowerCase() : false;
      return phoneMatch || emailMatch;
    }) ?? null;
  }

  async function buildKioskLoyaltyVerifyResponse(
    workspaceId: string,
    orgId: string,
    contact: { phone?: string | undefined; email?: string | undefined },
  ) {
    const [settings, customer] = await Promise.all([
      getLoyaltyConfig(workspaceId, orgId),
      findLoyaltyCustomerByContact(workspaceId, orgId, contact),
    ]);

    return {
      found: Boolean(customer),
      customer,
      ...settings,
      maxRedeemablePoints: customer?.points ?? 0,
    };
  }

  async function redeemKioskLoyaltyPoints(
    workspaceId: string,
    orgId: string,
    payload: z.infer<typeof KioskLoyaltyRedeemSchema>,
  ) {
    const settings = await getLoyaltyConfig(workspaceId, orgId);
    if (!settings.loyaltyEnabled) {
      throw createHttpError(400, 'Loyalty is disabled');
    }

    const customer = await db.query.posLoyaltyCustomers.findFirst({
      where: and(
        eq(posLoyaltyCustomers.id, payload.customerId),
        eq(posLoyaltyCustomers.workspaceId, workspaceId),
        eq(posLoyaltyCustomers.orgId, orgId),
      ),
    });
    if (!customer) {
      throw createHttpError(404, 'Customer not found');
    }

    const redemptionRate = Math.max(1, settings.loyaltyRedemptionRate);
    const redeemablePoints = Math.floor(Math.min(payload.points, customer.points) / redemptionRate) * redemptionRate;
    if (redeemablePoints <= 0) {
      throw createHttpError(400, 'Insufficient redeemable points');
    }

    const discountCents = Math.floor(redeemablePoints / redemptionRate) * 100;
    const newPoints = customer.points - redeemablePoints;
    const tier = newPoints >= 1000 ? 'gold' : newPoints >= 300 ? 'silver' : 'bronze';

    await db.transaction(async (tx) => {
      await tx.insert(posLoyaltyEvents).values({
        customerId: customer.id,
        orderId: payload.orderId ?? null,
        type: 'redeem',
        pointsDelta: -redeemablePoints,
        notes: payload.notes ?? 'Kiosk redemption',
      });
      await tx
        .update(posLoyaltyCustomers)
        .set({ points: newPoints, tier, updatedAt: new Date() })
        .where(eq(posLoyaltyCustomers.id, customer.id));
    });

    return {
      customerId: customer.id,
      redeemedPoints: redeemablePoints,
      discountCents,
      remainingPoints: newPoints,
      tier,
    };
  }

  async function upsertRestaurantSettings(workspaceId: string, orgId: string, patch: Record<string, unknown>) {
    const existing = await db.query.posRestaurants.findFirst({
      where: and(eq(posRestaurants.workspaceId, workspaceId), eq(posRestaurants.orgId, orgId)),
    });

    const nextSettings = {
      ...getSettingsObject(existing?.settings),
      ...patch,
    };

    if (existing) {
      const [updated] = await db
        .update(posRestaurants)
        .set({ settings: nextSettings, updatedAt: new Date() })
        .where(eq(posRestaurants.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(posRestaurants)
      .values({
        orgId,
        workspaceId,
        name: '',
        settings: nextSettings,
      })
      .returning();
    return created;
  }

  async function getOrderByIdForOrg(orderId: string, orgId: string) {
    return db.query.posOrders.findFirst({
      where: and(eq(posOrders.id, orderId), eq(posOrders.orgId, orgId)),
    });
  }

  async function releaseTrackedTable(trackedId: string | null, workspaceId: string) {
    if (!trackedId) return;

    const trackedTable = await db.query.posTables.findFirst({
      where: and(eq(posTables.id, trackedId), eq(posTables.workspaceId, workspaceId)),
      columns: { id: true, status: true },
    });
    if (!trackedTable) return;

    await db
      .update(posTables)
      .set({ status: 'available', updatedAt: new Date() })
      .where(eq(posTables.id, trackedTable.id));
  }

  async function recalculateOrderTotal(orderId: string) {
    const rows = await db
      .select({ total: sql<number>`coalesce(sum(${posOrderItems.lineTotalCents}), 0)` })
      .from(posOrderItems)
      .where(eq(posOrderItems.orderId, orderId));

    const totalCents = Number(rows[0]?.total ?? 0);
    await db
      .update(posOrders)
      .set({ totalCents, updatedAt: new Date() })
      .where(eq(posOrders.id, orderId));
    return totalCents;
  }

  async function transitionOrderStatus(
    orderId: string,
    orgId: string,
    status: 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled',
  ) {
    const order = await getOrderByIdForOrg(orderId, orgId);
    if (!order) return null;

    const now = new Date();
    const set: Record<string, unknown> = {
      status,
      updatedAt: now,
    };
    if (status === 'completed') set['completedAt'] = now;
    if (status === 'cancelled') set['cancelledAt'] = now;

    const [updated] = await db
      .update(posOrders)
      .set(set)
      .where(and(eq(posOrders.id, orderId), eq(posOrders.orgId, orgId)))
      .returning();

    if (updated && (status === 'completed' || status === 'cancelled')) {
      await releaseTrackedTable(order.deviceId, order.workspaceId);
    }

    return updated ?? null;
  }

  async function hydrateOrders<
    T extends {
      id: string;
      orderNumber: number;
      status: string;
      customerName: string | null;
      notes: string | null;
      totalCents: number;
      createdAt: Date;
    },
  >(orders: T[]) {
    const orderIds = orders.map((order) => order.id);
    const lineItems = orderIds.length > 0
      ? await db.query.posOrderItems.findMany({
          where: inArray(posOrderItems.orderId, orderIds),
          orderBy: (t, { asc }) => [asc(t.createdAt)],
        })
      : [];

    const itemsByOrder = new Map<string, typeof lineItems>();
    for (const lineItem of lineItems) {
      const list = itemsByOrder.get(lineItem.orderId) ?? [];
      list.push(lineItem);
      itemsByOrder.set(lineItem.orderId, list);
    }

    return orders.map((order) => ({
      ...order,
      items: (itemsByOrder.get(order.id) ?? []).map((lineItem) => ({
        id: lineItem.id,
        itemName: lineItem.itemName,
        quantity: lineItem.quantity,
        unitPriceCents: lineItem.itemPriceCents,
        lineTotalCents: lineItem.lineTotalCents,
        notes: lineItem.notes,
      })),
    }));
  }


  // ── Kitchen WebSocket registry ───────────────────────────────────────────────
  // Map of workspaceId → Set of connected WebSocket clients
  const kitchenClients = new Map<string, Set<import('@fastify/websocket').WebSocket>>();

  function broadcastKitchenEvent(workspaceId: string, payload: Record<string, unknown>) {
    const clients = kitchenClients.get(workspaceId);
    if (!clients || clients.size === 0) return;
    const msg = JSON.stringify(payload);
    for (const ws of clients) {
      try {
        if (ws.readyState === 1 /* OPEN */) ws.send(msg);
      } catch {
        // ignore send errors; client will be cleaned up on close
      }
    }
  }

  // ── GET /pos/ws/kitchen?workspaceId=:wsId ───────────────────────────────────
  // Cookie-authenticated WebSocket — browser sends access_token cookie automatically
  app.get('/ws/kitchen', { websocket: true, onRequest: [app.authenticate] }, async (socket, req) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) {
      socket.close(4001, 'workspaceId required');
      return;
    }

    // Register client
    if (!kitchenClients.has(workspaceId)) kitchenClients.set(workspaceId, new Set());
    kitchenClients.get(workspaceId)!.add(socket);

    socket.on('close', () => {
      kitchenClients.get(workspaceId)?.delete(socket);
    });

    socket.on('error', () => {
      kitchenClients.get(workspaceId)?.delete(socket);
    });
  });

  // ── GET /pos/ws/kitchen-public?dt=:token ────────────────────────────────────
  // Display-token authenticated WebSocket — used by KitchenDisplayPage
  app.get('/ws/kitchen-public', { websocket: true }, async (socket, req) => {
    const query = req.query as Record<string, string | undefined>;
    const dtToken = (req.headers as Record<string, string | undefined>)['x-display-token'] ?? query['dt'];
    if (!dtToken) {
      socket.close(4001, 'Display token required');
      return;
    }

    let workspaceId: string;
    try {
      const payload = app.jwt.verify(dtToken) as { workspaceId?: string; type?: string; displayType?: string };
      if (payload.type !== 'display' || payload.displayType !== 'kitchen' || !payload.workspaceId) {
        socket.close(4003, 'Invalid display token');
        return;
      }
      workspaceId = payload.workspaceId;
    } catch {
      socket.close(4003, 'Invalid display token');
      return;
    }

    if (!kitchenClients.has(workspaceId)) kitchenClients.set(workspaceId, new Set());
    kitchenClients.get(workspaceId)!.add(socket);

    socket.on('close', () => {
      kitchenClients.get(workspaceId)?.delete(socket);
    });

    socket.on('error', () => {
      kitchenClients.get(workspaceId)?.delete(socket);
    });
  });

  // ── GET /pos/menu?workspaceId=:wsId ─────────────────────────────────────────
  // Public — returns the active menu with categories + items grouped
  app.get('/menu', async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const menu = await db.query.posMenus.findFirst({
      where: and(
        eq(posMenus.workspaceId, workspaceId),
        eq(posMenus.isActive, true),
        isNull(posMenus.deletedAt),
      ),
    });

    if (!menu) return reply.status(404).send({ error: 'No active menu found' });

    const categories = await db.query.posCategories.findMany({
      where: and(
        eq(posCategories.menuId, menu.id),
        eq(posCategories.isActive, true),
        isNull(posCategories.deletedAt),
      ),
      orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)],
    });

    const categoryIds = categories.map((c) => c.id);
    const items = categoryIds.length > 0
      ? await db.query.posItems.findMany({
          where: and(
            inArray(posItems.categoryId, categoryIds),
            eq(posItems.isAvailable, true),
            isNull(posItems.deletedAt),
          ),
          orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)],
        })
      : [];

    // Group items under their categories
    const itemsByCategory = new Map<string, typeof items>();
    for (const item of items) {
      const list = itemsByCategory.get(item.categoryId) ?? [];
      list.push(item);
      itemsByCategory.set(item.categoryId, list);
    }

    return reply.send({
      id:          menu.id,
      name:        menu.name,
      description: menu.description,
      currency:    menu.currency,
      categories:  categories.map((cat) => ({
        id:          cat.id,
        name:        cat.name,
        description: cat.description,
        imageUrl:    cat.imageUrl,
        color:       cat.color,
        items:       (itemsByCategory.get(cat.id) ?? []).map((item) => ({
          id:          item.id,
          name:        item.name,
          description: item.description,
          imageUrl:    item.imageUrl,
          priceCents:  item.priceCents,
          isAvailable: item.isAvailable,
          tags:        (item.tags as string[] | null) ?? [],
          modifiers:   (item.modifiers as object[] | null) ?? [],
        })),
      })),
    });
  });

  // ── GET /pos/orders?workspaceId=:wsId&status=pending,preparing ──────────────
  // Device token auth — kitchen display fetches active orders
  app.get('/orders', async (req, reply) => {
    const auth = authenticateDeviceRequest(req as never, reply as never, app);
    if (!auth) return;

    const { workspaceId, status } = req.query as {
      workspaceId?: string;
      status?: string;
    };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    // Allow device from any workspace to read — caller may pass a different wsId
    // (e.g. kitchen reads the same workspace). Just validate the token is a device.

    const requestedStatuses = status
      ? status
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is typeof VALID_ACTIVE_STATUSES[number] =>
            (VALID_ACTIVE_STATUSES as readonly string[]).includes(s),
          )
      : [...VALID_ACTIVE_STATUSES];

    const orders = await db.query.posOrders.findMany({
      where: and(
        eq(posOrders.workspaceId, workspaceId),
        requestedStatuses.length > 0
          ? inArray(posOrders.status, requestedStatuses)
          : undefined,
      ),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });

    const orderIds = orders.map((o) => o.id);
    const lineItems = orderIds.length > 0
      ? await db.query.posOrderItems.findMany({
          where: inArray(posOrderItems.orderId, orderIds),
          orderBy: (t, { asc }) => [asc(t.createdAt)],
        })
      : [];

    const itemsByOrder = new Map<string, typeof lineItems>();
    for (const li of lineItems) {
      const list = itemsByOrder.get(li.orderId) ?? [];
      list.push(li);
      itemsByOrder.set(li.orderId, list);
    }

    return reply.send(
      orders.map((o) => ({
        id:           o.id,
        orderNumber:  o.orderNumber,
        status:       o.status,
        customerName: o.customerName,
        notes:        o.notes,
        totalCents:   o.totalCents,
        createdAt:    o.createdAt,
        items: (itemsByOrder.get(o.id) ?? []).map((li) => ({
          id:             li.id,
          itemName:       li.itemName,
          quantity:       li.quantity,
          notes:          li.notes,
          lineTotalCents: li.lineTotalCents,
        })),
      })),
    );
  });

  // ── POST /pos/orders ─────────────────────────────────────────────────────────
  // Device token auth — kiosk creates a new order
  app.post('/orders', async (req, reply) => {
    const auth = authenticateKioskOrDisplayRequest(req as never, reply as never, app);
    if (!auth) return;

    const parsed = CreateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    // Use workspaceId from the verified token, not the client-supplied body value
    const workspaceId = auth.workspaceId;
    const { customerName, notes, items: inputItems } = parsed.data;

    // ── Resolve item prices from DB (never trust client-sent prices) ──────────
    const itemIds = [...new Set(inputItems.map((i) => i.itemId))];
    const menuItems = await db.query.posItems.findMany({
      where: and(
        inArray(posItems.id, itemIds),
        eq(posItems.isAvailable, true),
        isNull(posItems.deletedAt),
      ),
    });

    const itemMap = new Map(menuItems.map((m) => [m.id, m]));
    for (const input of inputItems) {
      if (!itemMap.has(input.itemId)) {
        return reply.status(400).send({ error: `Item ${input.itemId} not found or unavailable` });
      }
    }

    // ── Get the menu's orgId via workspace link ───────────────────────────────
    const menu = await db.query.posMenus.findFirst({
      where: and(
        eq(posMenus.workspaceId, workspaceId),
        eq(posMenus.isActive, true),
        isNull(posMenus.deletedAt),
      ),
      columns: { id: true, orgId: true },
    });
    if (!menu) return reply.status(400).send({ error: 'No active menu for this workspace' });

    // ── Build line items with server-side prices ──────────────────────────────
    type LineItem = {
      itemId: string;
      itemName: string;
      itemPriceCents: number;
      quantity: number;
      notes: string;
      selectedModifiers: { groupName: string; optionName: string; priceCents: number }[];
      lineTotalCents: number;
    };

    const lineItems: LineItem[] = inputItems.map((input) => {
      const dbItem = itemMap.get(input.itemId)!;
      const modifierTotal = (input.selectedModifiers ?? []).reduce(
        (sum, m) => sum + m.priceCents,
        0,
      );
      const unitCents     = dbItem.priceCents + modifierTotal;
      return {
        itemId:            input.itemId,
        itemName:          dbItem.name,
        itemPriceCents:    dbItem.priceCents,
        quantity:          input.quantity,
        notes:             input.notes ?? '',
        selectedModifiers: input.selectedModifiers ?? [],
        lineTotalCents:    unitCents * input.quantity,
      };
    });

    const totalCents = lineItems.reduce((sum, li) => sum + li.lineTotalCents, 0);

    // ── Atomically increment order sequence counter ───────────────────────────
    const [seq] = await db
      .insert(posOrderSequences)
      .values({ workspaceId, lastOrderNumber: 1 })
      .onConflictDoUpdate({
        target: posOrderSequences.workspaceId,
        set: {
          lastOrderNumber: sql`${posOrderSequences.lastOrderNumber} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ orderNumber: posOrderSequences.lastOrderNumber });

    const orderNumber = seq!.orderNumber;

    // ── Insert order + line items in a transaction ────────────────────────────
    const [order] = await db
      .insert(posOrders)
      .values({
        orgId:        menu.orgId,
        workspaceId,
        orderNumber,
        status:       'pending',
        totalCents,
        customerName: customerName ?? null,
        notes:        notes ?? null,
      })
      .returning({ id: posOrders.id, orderNumber: posOrders.orderNumber });

    if (!order) return reply.status(500).send({ error: 'Failed to create order' });

    await db.insert(posOrderItems).values(
      lineItems.map((li) => ({
        orderId:           order.id,
        itemId:            li.itemId,
        itemName:          li.itemName,
        itemPriceCents:    li.itemPriceCents,
        quantity:          li.quantity,
        notes:             li.notes || null,
        selectedModifiers: li.selectedModifiers,
        lineTotalCents:    li.lineTotalCents,
      })),
    );

    broadcastKitchenEvent(workspaceId, {
      type: 'order_created',
      order: { id: order.id, orderNumber: order.orderNumber, totalCents, status: 'pending' },
    });

    return reply.status(201).send({ id: order.id, orderNumber: order.orderNumber, totalCents });
  });

  // ── PATCH /pos/orders/:orderId/status ────────────────────────────────────────
  // Device token auth — kitchen staff updates order status
  app.patch('/orders/:orderId/status', async (req, reply) => {
    const auth = authenticateDeviceRequest(req as never, reply as never, app);
    if (!auth) return;

    const { orderId } = req.params as { orderId: string };
    const parsed = UpdateOrderStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid status', details: parsed.error.flatten() });
    }

    const { status } = parsed.data;

    const updated = await transitionOrderStatus(orderId, auth.orgId, status);
    if (!updated) return reply.status(404).send({ error: 'Order not found' });

    return reply.send({ id: orderId, status });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // SESSION-AUTHENTICATED MANAGEMENT ROUTES
  // ══════════════════════════════════════════════════════════════════════════════

  type AuthUser = { sub: string; orgId: string; role: string };

  // ─── Helper: accept either a waiter display JWT (Bearer) or a session cookie ─
  // Used by endpoints that both the waiter tablet and session-authenticated portal
  // need to reach. Returns the `orgId` on success, or sends 401 and returns null.
  async function requireWaiterOrSession(
    req: { headers: Record<string, string | string[] | undefined>; user: unknown },
    reply: { status: (n: number) => { send: (b: unknown) => void } },
  ): Promise<{ orgId: string } | null> {
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      try {
        const p = app.jwt.verify<{ type: string; displayType: string; orgId: string; workspaceId: string }>(
          authHeader.slice(7),
        );
        if (p.type === 'display' && p.displayType === 'waiter' && p.orgId) {
          // Inject into req.user so existing code that does `req.user as AuthUser` works
          (req as { user: unknown }).user = { sub: `display:${p.workspaceId}`, orgId: p.orgId, role: 'pos_display' };
          return { orgId: p.orgId };
        }
      } catch {
        // fall through to session auth
      }
    }
    // Fall back to session / cookie auth
    try {
      await (app.authenticate as (req: unknown, reply: unknown) => Promise<void>)(req, reply);
      return { orgId: (req.user as AuthUser).orgId };
    } catch {
      return null;
    }
  }

  // ── GET /pos/display/pin-status?workspaceId= ─────────────────────────────────
  // Public — returns whether a display PIN is configured for the workspace
  app.get('/display/pin-status', async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const ws = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
      columns: { settings: true },
    });
    if (!ws) return reply.status(404).send({ error: 'Workspace not found' });

    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(ws.settings) as Record<string, unknown>; } catch { /* ignore */ }
    return reply.send({ required: Boolean(settings['posDisplayPin']) });
  });

  // ── POST /pos/display/verify-pin ─────────────────────────────────────────────
  // Public — verify PIN and return a short-lived waiter display JWT
  const VerifyPinSchema = z.object({
    workspaceId: z.string().uuid(),
    pin: z.string().max(20),
  });

  app.post('/display/verify-pin', async (req, reply) => {
    const parsed = VerifyPinSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' });

    const ws = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, parsed.data.workspaceId),
      columns: { id: true, orgId: true, settings: true },
    });
    if (!ws) return reply.status(404).send({ error: 'Workspace not found' });

    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(ws.settings) as Record<string, unknown>; } catch { /* ignore */ }
    const storedPin = settings['posDisplayPin'];

    if (storedPin && String(storedPin) !== String(parsed.data.pin)) {
      return reply.send({ valid: false });
    }

    const token = app.jwt.sign(
      { type: 'display', displayType: 'waiter', workspaceId: ws.id, orgId: ws.orgId },
      { expiresIn: '24h' },
    );
    return reply.send({ valid: true, token });
  });

  // ── PUT /pos/mgmt/display-pin ─────────────────────────────────────────────────
  // Session auth — set or update the display PIN
  const SetDisplayPinSchema = z.object({
    workspaceId: z.string().uuid(),
    pin: z.string().regex(/^\d{4,8}$/, 'PIN must be 4–8 digits'),
  });

  app.put('/mgmt/display-pin', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = SetDisplayPinSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid request' });

    const ws = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, parsed.data.workspaceId), eq(workspaces.orgId, user.orgId)),
      columns: { id: true, settings: true },
    });
    if (!ws) return reply.status(404).send({ error: 'Workspace not found' });

    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(ws.settings) as Record<string, unknown>; } catch { /* ignore */ }
    settings['posDisplayPin'] = parsed.data.pin;

    await db.update(workspaces)
      .set({ settings: JSON.stringify(settings), updatedAt: new Date() })
      .where(eq(workspaces.id, ws.id));

    return reply.send({ ok: true });
  });

  // ── DELETE /pos/mgmt/display-pin?workspaceId= ────────────────────────────────
  // Session auth — remove the display PIN
  app.delete('/mgmt/display-pin', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const ws = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)),
      columns: { id: true, settings: true },
    });
    if (!ws) return reply.status(404).send({ error: 'Workspace not found' });

    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(ws.settings) as Record<string, unknown>; } catch { /* ignore */ }
    delete settings['posDisplayPin'];

    await db.update(workspaces)
      .set({ settings: JSON.stringify(settings), updatedAt: new Date() })
      .where(eq(workspaces.id, ws.id));

    return reply.status(204).send();
  });

  // ─── Restaurant profile ──────────────────────────────────────────────────────

  app.get('/restaurant', async (req, reply) => {
    const auth = await requireWaiterOrSession(req, reply);
    if (!auth) return;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const restaurant = await db.query.posRestaurants.findFirst({
      where: and(eq(posRestaurants.workspaceId, workspaceId), eq(posRestaurants.orgId, auth.orgId)),
    });

    if (!restaurant) return reply.send(null);
    return reply.send(restaurant);
  });

  app.put('/restaurant', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const body = req.body as {
      name?: string;
      address?: string | null;
      phone?: string | null;
      email?: string | null;
      currency?: string;
      taxRatePct?: number;
      receiptHeader?: string | null;
      receiptFooter?: string | null;
      loyaltyEnabled?: boolean;
      loyaltyPointsPerDollar?: number;
      loyaltyRedemptionRate?: number;
    };

    const existing = await db.query.posRestaurants.findFirst({
      where: and(eq(posRestaurants.workspaceId, workspaceId), eq(posRestaurants.orgId, user.orgId)),
      columns: { id: true },
    });

    if (existing) {
      const [updated] = await db
        .update(posRestaurants)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(posRestaurants.id, existing.id))
        .returning();
      return reply.send(updated);
    } else {
      const [created] = await db
        .insert(posRestaurants)
        .values({ workspaceId, orgId: user.orgId, name: body.name ?? '', ...body })
        .returning();
      return reply.status(201).send(created);
    }
  });

  // ─── Tables ──────────────────────────────────────────────────────────────────

  app.get('/tables', async (req, reply) => {
    const auth = await requireWaiterOrSession(req, reply);
    if (!auth) return;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const tables = await db.query.posTables.findMany({
      where: and(eq(posTables.workspaceId, workspaceId), eq(posTables.isActive, true)),
      orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.number)],
    });
    return reply.send(tables);
  });

  app.post('/tables', { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = req.body as { workspaceId?: string; number?: number | null; name?: string; seats?: number; location?: string };
    const workspaceId = (req.query as { workspaceId?: string }).workspaceId ?? body.workspaceId;
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    let tableNumber = body.number != null ? Number(body.number) : null;
    if (!tableNumber) {
      // Auto-assign next available number for this workspace
      const [row] = await db
        .select({ max: sql<number>`coalesce(max(${posTables.number}), 0)` })
        .from(posTables)
        .where(eq(posTables.workspaceId, workspaceId));
      tableNumber = (row?.max ?? 0) + 1;
    }

    const [table] = await db
      .insert(posTables)
      .values({ workspaceId, number: tableNumber, name: body.name ?? null, seats: body.seats ?? 4, location: body.location ?? null })
      .returning();
    return reply.status(201).send(table);
  });

  app.patch('/tables/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; seats?: number; location?: string; number?: number; isActive?: boolean };
    const [updated] = await db
      .update(posTables)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(posTables.id, id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Table not found' });
    return reply.send(updated);
  });

  app.delete('/tables/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.update(posTables).set({ isActive: false, updatedAt: new Date() }).where(eq(posTables.id, id));
    return reply.status(204).send();
  });

  // ─── Kiosk config ────────────────────────────────────────────────────────────

  app.get('/kiosk-config', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const config = await db.query.posKioskConfig.findFirst({
      where: eq(posKioskConfig.workspaceId, workspaceId),
    });
    return reply.send(config ?? null);
  });

  app.put('/kiosk-config', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const body = req.body as {
      orientation?: string;
      welcomeMessage?: string | null;
      idleTimeoutSeconds?: number;
      logoUrl?: string | null;
      qrOrderingEnabled?: boolean;
      primaryColor?: string | null;
    };

    const user = req.user as { sub: string; orgId: string; role: string };
    const [config] = await db
      .insert(posKioskConfig)
      .values({ workspaceId, ...body, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: posKioskConfig.workspaceId,
        set: { ...body, updatedAt: new Date() },
      })
      .returning();
    // Notify paired kiosk displays so they reload immediately
    void notifyPosDevices(user.orgId, workspaceId, ['kiosk-portrait', 'kiosk-landscape']);
    return reply.send(config);
  });

  // ─── Kitchen config ────────────────────────────────────────────────────────

  app.get('/kitchen-config', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    const config = await db.query.posKitchenConfig.findFirst({
      where: eq(posKitchenConfig.workspaceId, workspaceId),
    });
    return reply.send(config ?? null);
  });

  app.put('/kitchen-config', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    const body = req.body as {
      columnCount?: number;
      soundEnabled?: boolean;
      alertIntervalSec?: number;
      theme?: string;
    };
    const user = req.user as { sub: string; orgId: string; role: string };
    const [config] = await db
      .insert(posKitchenConfig)
      .values({ workspaceId, ...body, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: posKitchenConfig.workspaceId,
        set: { ...body, updatedAt: new Date() },
      })
      .returning();
    // Notify paired kitchen displays so they reload immediately
    void notifyPosDevices(user.orgId, workspaceId, ['kitchen']);
    return reply.send(config);
  });

  // Public kitchen config — display-token authenticated, used by KitchenDisplayPage
  app.get('/kiosk/kitchen-config', async (req, reply) => {
    const auth = authenticateDisplayRequest(req as never, reply as never, app);
    if (!auth) return;
    const config = await db.query.posKitchenConfig.findFirst({
      where: eq(posKitchenConfig.workspaceId, auth.workspaceId),
    });
    return reply.send(config ?? null);
  });

  // Public kiosk config — display-token authenticated, used by KioskDisplayPage
  app.get('/kiosk/kiosk-config', async (req, reply) => {
    const auth = authenticateDisplayRequest(req as never, reply as never, app);
    if (!auth) return;
    const config = await db.query.posKioskConfig.findFirst({
      where: eq(posKioskConfig.workspaceId, auth.workspaceId),
    });
    return reply.send(config ?? null);
  });

  // ─── Store status + today's special ────────────────────────────────────────

  app.get('/store/status', async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const restaurant = await db.query.posRestaurants.findFirst({
      where: eq(posRestaurants.workspaceId, workspaceId),
      columns: { settings: true },
    });
    const settings = getSettingsObject(restaurant?.settings);
    const storeStatus = getSettingsObject(settings['storeStatus']);

    return reply.send({
      isOpen: storeStatus['isOpen'] !== false,
      note: typeof storeStatus['note'] === 'string' ? storeStatus['note'] : null,
      updatedAt: typeof storeStatus['updatedAt'] === 'string' ? storeStatus['updatedAt'] : null,
    });
  });

  app.put('/store/status', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = UpdateStoreStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const now = new Date().toISOString();
    const restaurant = await upsertRestaurantSettings(parsed.data.workspaceId, user.orgId, {
      storeStatus: {
        isOpen: parsed.data.isOpen,
        note: parsed.data.note ?? null,
        updatedAt: now,
      },
    });

    return reply.send({
      workspaceId: parsed.data.workspaceId,
      isOpen: parsed.data.isOpen,
      note: parsed.data.note ?? null,
      updatedAt: now,
      restaurantId: restaurant?.id ?? null,
    });
  });

  app.get('/todays-special', async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const restaurant = await db.query.posRestaurants.findFirst({
      where: eq(posRestaurants.workspaceId, workspaceId),
      columns: { settings: true },
    });
    const settings = getSettingsObject(restaurant?.settings);
    const todaysSpecial = getSettingsObject(settings['todaysSpecial']);

    if (Object.keys(todaysSpecial).length === 0) return reply.send(null);
    return reply.send(todaysSpecial);
  });

  app.put('/todays-special', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = UpdateTodaysSpecialSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const parsedEndsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
    if (parsed.data.endsAt && Number.isNaN(parsedEndsAt?.getTime())) {
      return reply.status(400).send({ error: 'Invalid endsAt' });
    }

    let special = {
      name: parsed.data.name ?? '',
      description: parsed.data.description ?? null,
      priceCents: parsed.data.priceCents ?? 0,
      imageUrl: parsed.data.imageUrl ?? null,
      itemId: parsed.data.itemId ?? null,
      updatedAt: new Date().toISOString(),
      endsAt: parsedEndsAt ? parsedEndsAt.toISOString() : null,
    };

    if (parsed.data.itemId) {
      const item = await db.query.posItems.findFirst({
        where: eq(posItems.id, parsed.data.itemId),
      });
      if (!item) return reply.status(404).send({ error: 'Item not found' });

      const category = await db.query.posCategories.findFirst({
        where: eq(posCategories.id, item.categoryId),
        columns: { menuId: true },
      });
      if (!category) return reply.status(404).send({ error: 'Category not found' });

      const menu = await db.query.posMenus.findFirst({
        where: and(eq(posMenus.id, category.menuId), eq(posMenus.workspaceId, parsed.data.workspaceId)),
        columns: { id: true },
      });
      if (!menu) return reply.status(400).send({ error: 'Item does not belong to this workspace menu' });

      special = {
        ...special,
        name: item.name,
        description: item.description ?? special.description,
        priceCents: item.priceCents,
        imageUrl: item.imageUrl ?? special.imageUrl,
      };
    }

    await upsertRestaurantSettings(parsed.data.workspaceId, user.orgId, {
      todaysSpecial: special,
    });
    return reply.send(special);
  });

  app.delete('/todays-special', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    await upsertRestaurantSettings(workspaceId, user.orgId, {
      todaysSpecial: null,
    });
    return reply.status(204).send();
  });

  // ─── Kitchen display device routes (display-token authenticated) ────────────

  app.get('/kiosk/kitchen-orders', async (req, reply) => {
    const auth = authenticateDisplayRequest(req as never, reply as never, app);
    if (!auth) return;
    if (auth.displayType !== 'kitchen') {
      return reply.status(403).send({ error: 'This token is not a kitchen display token' });
    }

    const orders = await db.query.posOrders.findMany({
      where: and(
        eq(posOrders.workspaceId, auth.workspaceId),
        inArray(posOrders.status, ['pending', 'preparing', 'ready']),
      ),
      with: { items: true },
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });
    return reply.send(orders);
  });

  app.patch('/kiosk/kitchen-orders/:orderId/status', async (req, reply) => {
    const auth = authenticateDisplayRequest(req as never, reply as never, app);
    if (!auth) return;
    if (auth.displayType !== 'kitchen') {
      return reply.status(403).send({ error: 'This token is not a kitchen display token' });
    }

    const { orderId } = req.params as { orderId: string };
    const parsed = UpdateOrderStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid status', details: parsed.error.flatten() });
    }

    const order = await db.query.posOrders.findFirst({
      where: and(eq(posOrders.id, orderId), eq(posOrders.workspaceId, auth.workspaceId)),
    });
    if (!order) return reply.status(404).send({ error: 'Order not found' });

    const [updated] = await db
      .update(posOrders)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(posOrders.id, orderId))
      .returning();

    broadcastKitchenEvent(auth.workspaceId, { type: 'order_updated', order: updated });

    // When a kitchen display manually accepts/cancels an Uber Eats order, sync to Uber
    if (order.source === 'uber-eats' && order.externalId) {
      const uberOrderId = order.externalId;
      void (async () => {
        try {
          const tok = await uberEatsLib.getAppToken();
          if (parsed.data.status === 'preparing' && order.status === 'pending') {
            await uberEatsLib.acceptOrder(tok, uberOrderId);
          } else if (parsed.data.status === 'cancelled') {
            await uberEatsLib.denyOrder(tok, uberOrderId);
          }
        } catch (e) {
          console.error('[uber-eats] kitchen status sync error:', e);
        }
      })();
    }

    return reply.send(updated);
  });

  // ─── Kiosk device utility routes ───────────────────────────────────────────

  app.get('/kiosk/loyalty/settings', async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;

    // Accept display token (display screens) OR session cookie (management portal)
    const dtToken = (req.headers as Record<string, string | undefined>)['x-display-token'] ?? query.dt;
    if (dtToken) {
      const auth = authenticateDisplayRequest(req as never, reply as never, app);
      if (!auth) return;
      return reply.send(await getLoyaltyConfig(auth.workspaceId, auth.orgId));
    }

    // Fall back to session auth (management page calling without a display token)
    try {
      await (app.authenticate as (req: unknown, reply: unknown) => Promise<void>)(req, reply);
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const user = req.user as AuthUser;
    const workspaceId = query.workspaceId;
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    return reply.send(await getLoyaltyConfig(workspaceId, user.orgId));
  });

  app.post('/kiosk/loyalty/verify', async (req, reply) => {
    const auth = authenticateKioskOrDisplayRequest(req as never, reply as never, app);
    if (!auth) return;

    const parsed = KioskLoyaltyVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    return reply.send(await buildKioskLoyaltyVerifyResponse(parsed.data.workspaceId, auth.orgId, parsed.data));
  });

  app.post('/kiosk/loyalty/redeem', async (req, reply) => {
    const auth = authenticateKioskOrDisplayRequest(req as never, reply as never, app);
    if (!auth) return;

    const parsed = KioskLoyaltyRedeemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    try {
      return reply.send(await redeemKioskLoyaltyPoints(parsed.data.workspaceId, auth.orgId, parsed.data));
    } catch (error) {
      const statusCode = error instanceof Error && 'statusCode' in error ? Number((error as Error & { statusCode?: number }).statusCode) : 500;
      const message = error instanceof Error ? error.message : 'Failed to redeem loyalty points';
      return reply.status(statusCode).send({ error: message });
    }
  });

  app.post('/mgmt/kiosk/loyalty/verify', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = KioskLoyaltyVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    return reply.send(await buildKioskLoyaltyVerifyResponse(parsed.data.workspaceId, user.orgId, parsed.data));
  });

  app.post('/mgmt/kiosk/loyalty/redeem', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = KioskLoyaltyRedeemSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    try {
      return reply.send(await redeemKioskLoyaltyPoints(parsed.data.workspaceId, user.orgId, parsed.data));
    } catch (error) {
      const statusCode = error instanceof Error && 'statusCode' in error ? Number((error as Error & { statusCode?: number }).statusCode) : 500;
      const message = error instanceof Error ? error.message : 'Failed to redeem loyalty points';
      return reply.status(statusCode).send({ error: message });
    }
  });

  app.post('/kiosk/heartbeat', async (req, reply) => {
    const auth = authenticateDeviceRequest(req as never, reply as never, app);
    if (!auth) return;

    const payload = (req.body as Record<string, unknown> | undefined) ?? {};
    const readiness = payload['readiness'];
    const hb = readiness != null && typeof readiness === 'object' && !Array.isArray(readiness)
      ? {
          ...payload,
          clockDriftMs: (readiness as Record<string, unknown>)['driftMs'],
          currentContentId: (readiness as Record<string, unknown>)['currentContentId'],
          nextContentId: (readiness as Record<string, unknown>)['nextContentId'],
          nextStartsAt: (readiness as Record<string, unknown>)['nextStartsAt'],
        }
      : payload;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const currentContentId = typeof hb['currentContentId'] === 'string' && uuidPattern.test(hb['currentContentId'])
      ? hb['currentContentId']
      : null;
    const nextContentId = typeof hb['nextContentId'] === 'string' && uuidPattern.test(hb['nextContentId'])
      ? hb['nextContentId']
      : null;
    const nextStartsAt = typeof hb['nextStartsAt'] === 'string'
      ? new Date(hb['nextStartsAt'])
      : null;

    await db
      .update(devices)
      .set({
        status: 'online',
        lastSeen: new Date(),
        ...(typeof hb['playerVersion'] === 'string' ? { playerVersion: hb['playerVersion'] } : {}),
        ...(typeof hb['firmwareVersion'] === 'string' ? { firmwareVersion: hb['firmwareVersion'] } : {}),
        ...(typeof hb['powerState'] === 'string' ? { powerState: hb['powerState'] } : {}),
        updatedAt: new Date(),
      })
      .where(eq(devices.id, auth.deviceId));

    await db.insert(deviceHeartbeats).values({
      deviceId: auth.deviceId,
      playerVersion: typeof hb['playerVersion'] === 'string' ? hb['playerVersion'] : null,
      firmwareVersion: typeof hb['firmwareVersion'] === 'string' ? hb['firmwareVersion'] : null,
      powerState: typeof hb['powerState'] === 'string' ? hb['powerState'] : null,
      clockDriftMs: typeof hb['clockDriftMs'] === 'number' ? hb['clockDriftMs'] : null,
      cpuLoad: typeof hb['cpuLoad'] === 'number' ? hb['cpuLoad'] : null,
      storageFreeBytes: typeof hb['storageFreeBytes'] === 'number' ? hb['storageFreeBytes'] : null,
      memoryFreeBytes: typeof hb['memoryFreeBytes'] === 'number' ? hb['memoryFreeBytes'] : null,
      memoryTotalBytes: typeof hb['memoryTotalBytes'] === 'number' ? hb['memoryTotalBytes'] : null,
      deviceUptimeSec: typeof hb['deviceUptimeSec'] === 'number' ? hb['deviceUptimeSec'] : null,
      temperatureC: typeof hb['temperatureCelsius'] === 'number' ? hb['temperatureCelsius'] : null,
      currentContentId,
      nextContentId,
      nextStartsAt: nextStartsAt && !Number.isNaN(nextStartsAt.getTime()) ? nextStartsAt : null,
    });

    return reply.send({ ok: true, timestamp: new Date().toISOString() });
  });

  // ─── Menu management (session auth) ──────────────────────────────────────────

  app.get('/mgmt/menus', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const menus = await db.query.posMenus.findMany({
      where: and(eq(posMenus.workspaceId, workspaceId), isNull(posMenus.deletedAt)),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });
    return reply.send(menus);
  });

  app.post('/mgmt/menus', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId: string; name: string; currency?: string };
    const [menu] = await db
      .insert(posMenus)
      .values({ orgId: user.orgId, workspaceId: body.workspaceId, name: body.name, currency: body.currency ?? 'USD' })
      .returning();
    return reply.status(201).send(menu);
  });

  app.get('/mgmt/categories', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { menuId } = req.query as { menuId?: string };
    if (!menuId) return reply.status(400).send({ error: 'menuId required' });

    const cats = await db.query.posCategories.findMany({
      where: and(eq(posCategories.menuId, menuId), isNull(posCategories.deletedAt)),
      orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)],
    });
    return reply.send(cats);
  });

  app.post('/mgmt/categories', { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = req.body as { menuId: string; name: string };
    const [cat] = await db
      .insert(posCategories)
      .values({ menuId: body.menuId, name: body.name })
      .returning();
    return reply.status(201).send(cat);
  });

  app.get('/mgmt/items', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { categoryId } = req.query as { categoryId?: string };
    if (!categoryId) return reply.status(400).send({ error: 'categoryId required' });

    const items = await db.query.posItems.findMany({
      where: and(eq(posItems.categoryId, categoryId), isNull(posItems.deletedAt)),
      orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)],
    });
    return reply.send(items);
  });

  app.post('/mgmt/items', { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = req.body as {
      categoryId: string; name: string; priceCents: number; description?: string | null;
      tags?: string[];
      allergens?: string[];
      nutritionInfo?: { calories?: number; fatG?: number; carbsG?: number; proteinG?: number; sodiumMg?: number } | null;
      nameI18n?: Record<string, string>;
      descriptionI18n?: Record<string, string>;
      inventoryCount?: number | null;
      autoHideWhenEmpty?: boolean;
      modifiers?: { id: string; name: string; required: boolean; maxSelect: number; options: { id: string; name: string; priceCents: number }[] }[];
    };
    const [item] = await db
      .insert(posItems)
      .values({
        categoryId: body.categoryId,
        name: body.name,
        priceCents: body.priceCents,
        description: body.description ?? null,
        ...(body.tags ? { tags: body.tags } : {}),
        ...(body.allergens ? { allergens: body.allergens } : {}),
        ...(body.nutritionInfo !== undefined ? { nutritionInfo: body.nutritionInfo } : {}),
        ...(body.nameI18n ? { nameI18n: body.nameI18n } : {}),
        ...(body.descriptionI18n ? { descriptionI18n: body.descriptionI18n } : {}),
        ...(body.inventoryCount !== undefined ? { inventoryCount: body.inventoryCount } : {}),
        ...(body.autoHideWhenEmpty !== undefined ? { autoHideWhenEmpty: body.autoHideWhenEmpty } : {}),
        ...(body.modifiers ? { modifiers: body.modifiers } : {}),
      })
      .returning();
    return reply.status(201).send(item);
  });

  app.patch('/mgmt/items/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string; priceCents?: number; description?: string | null;
      isAvailable?: boolean; imageUrl?: string | null; tags?: string[];
      unavailableReason?: string | null;
      allergens?: string[];
      nutritionInfo?: { calories?: number; fatG?: number; carbsG?: number; proteinG?: number; sodiumMg?: number } | null;
      nameI18n?: Record<string, string>;
      descriptionI18n?: Record<string, string>;
      inventoryCount?: number | null;
      autoHideWhenEmpty?: boolean;
      modifiers?: { id: string; name: string; required: boolean; maxSelect: number; options: { id: string; name: string; priceCents: number }[] }[];
    };

    // Item "86" bookkeeping: stamp/clear unavailableSince + reason on toggle
    const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };
    if (body.isAvailable === false) {
      patch['unavailableSince'] = new Date();
      patch['unavailableReason'] = body.unavailableReason ?? null;
    } else if (body.isAvailable === true) {
      patch['unavailableSince'] = null;
      patch['unavailableReason'] = null;
    }

    const [updated] = await db
      .update(posItems)
      .set(patch)
      .where(eq(posItems.id, id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Item not found' });
    return reply.send(updated);
  });

  app.delete('/mgmt/items/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.update(posItems).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(posItems.id, id));
    return reply.status(204).send();
  });

  // ─── Bulk CSV import ─────────────────────────────────────────────────────────
  // Accepts pre-parsed rows from the client (flexible column mapping done in UI).
  // Finds-or-creates categories by name, then batch-inserts items.
  app.post('/mgmt/csv-import', { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = req.body as {
      menuId: string;
      rows: { name?: string; priceCents?: number; categoryName?: string; description?: string | null }[];
    };
    if (!body.menuId) return reply.status(400).send({ error: 'menuId required' });
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return reply.status(400).send({ error: 'rows required' });
    }

    const menu = await db.query.posMenus.findFirst({
      where: and(eq(posMenus.id, body.menuId), isNull(posMenus.deletedAt)),
      columns: { id: true },
    });
    if (!menu) return reply.status(404).send({ error: 'Menu not found' });

    // Pre-load existing categories for this menu (case-insensitive name match)
    const existingCats = await db.query.posCategories.findMany({
      where: and(eq(posCategories.menuId, body.menuId), isNull(posCategories.deletedAt)),
      columns: { id: true, name: true },
    });
    const catByName = new Map<string, string>();
    for (const c of existingCats) catByName.set(c.name.trim().toLowerCase(), c.id);

    const errors: { row: number; reason: string }[] = [];
    let created = 0;
    let skipped = 0;

    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i]!;
      const name = (row.name ?? '').trim();
      if (!name) {
        skipped++;
        errors.push({ row: i + 1, reason: 'missing name' });
        continue;
      }
      const priceCents = Number.isFinite(row.priceCents) ? Math.max(0, Math.round(Number(row.priceCents))) : 0;
      const catName = (row.categoryName ?? 'Uncategorized').trim() || 'Uncategorized';
      const catKey = catName.toLowerCase();

      let categoryId = catByName.get(catKey);
      if (!categoryId) {
        const [cat] = await db
          .insert(posCategories)
          .values({ menuId: body.menuId, name: catName, sortOrder: existingCats.length + catByName.size })
          .returning({ id: posCategories.id });
        if (!cat) { skipped++; errors.push({ row: i + 1, reason: 'category create failed' }); continue; }
        categoryId = cat.id;
        catByName.set(catKey, categoryId);
      }

      try {
        await db.insert(posItems).values({
          categoryId,
          name,
          priceCents,
          description: row.description?.trim() || null,
        });
        created++;
      } catch {
        skipped++;
        errors.push({ row: i + 1, reason: 'insert failed' });
      }
    }

    return reply.send({ created, skipped, errors });
  });

  // ─── Menu Schedules (day-part switching) ─────────────────────────────────────

  // GET /pos/mgmt/schedules?workspaceId=...  → all schedules for workspace
  app.get('/mgmt/schedules', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    const schedules = await db
      .select()
      .from(posMenuSchedules)
      .where(eq(posMenuSchedules.workspaceId, workspaceId));
    return reply.send(schedules);
  });

  // POST /pos/mgmt/schedules  → create schedule
  app.post('/mgmt/schedules', { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = req.body as {
      menuId: string; workspaceId: string; label: string;
      startTime: string; endTime: string;
      dayOfWeek?: number[] | null; isActive?: boolean;
    };
    if (!body.menuId || !body.workspaceId || !body.label || !body.startTime || !body.endTime) {
      return reply.status(400).send({ error: 'menuId, workspaceId, label, startTime, endTime required' });
    }
    const [schedule] = await db
      .insert(posMenuSchedules)
      .values({
        menuId: body.menuId,
        workspaceId: body.workspaceId,
        label: body.label,
        startTime: body.startTime,
        endTime: body.endTime,
        dayOfWeek: body.dayOfWeek ?? null,
        isActive: body.isActive ?? true,
      })
      .returning();
    return reply.status(201).send(schedule);
  });

  // PATCH /pos/mgmt/schedules/:id
  app.patch('/mgmt/schedules/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      menuId?: string; label?: string; startTime?: string; endTime?: string;
      dayOfWeek?: number[] | null; isActive?: boolean;
    };
    const [updated] = await db
      .update(posMenuSchedules)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(posMenuSchedules.id, id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Schedule not found' });
    return reply.send(updated);
  });

  // DELETE /pos/mgmt/schedules/:id
  app.delete('/mgmt/schedules/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(posMenuSchedules).where(eq(posMenuSchedules.id, id));
    return reply.status(204).send();
  });

  // GET /pos/active-menu?workspaceId=...
  // Returns the menuId of the schedule whose time window covers the current server time.
  // Falls back to the workspace's first active menu if no schedule matches.
  app.get('/active-menu', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const now = new Date();
    const dow = now.getDay(); // 0=Sun
    const hhmm = now.toTimeString().slice(0, 5); // "HH:MM"

    const schedules = await db
      .select()
      .from(posMenuSchedules)
      .where(and(eq(posMenuSchedules.workspaceId, workspaceId), eq(posMenuSchedules.isActive, true)));

    // Find a matching schedule (dayOfWeek null = any day; compare time strings lexicographically)
    const match = schedules.find((s) => {
      const dayOk = !s.dayOfWeek || (s.dayOfWeek as number[]).includes(dow);
      const timeOk = hhmm >= s.startTime && hhmm < s.endTime;
      return dayOk && timeOk;
    });

    if (match) return reply.send({ menuId: match.menuId, source: 'schedule' });

    // Fallback: first active menu for workspace
    const menus = await db
      .select({ id: posMenus.id })
      .from(posMenus)
      .where(and(eq(posMenus.workspaceId, workspaceId), eq(posMenus.isActive, true), isNull(posMenus.deletedAt)))
      .limit(1);
    const menuId = menus[0]?.id ?? null;
    return reply.send({ menuId, source: 'fallback' });
  });

  // ─── QR Menu — public (no auth) ──────────────────────────────────────────────
  // GET /pos/qr-menu/:wsId/:menuId
  // Returns full menu data suitable for the QR code scan page (phone-friendly).
  // Filters out: deleted, unavailable, and auto-hidden sold-out items.
  // Accepts optional ?lang=fr query param (falls back to "en" / primary name).
  app.get('/qr-menu/:wsId/:menuId', async (req, reply) => {
    const { wsId, menuId } = req.params as { wsId: string; menuId: string };

    const menu = await db.query.posMenus.findFirst({
      where: and(eq(posMenus.id, menuId), eq(posMenus.workspaceId, wsId), isNull(posMenus.deletedAt), eq(posMenus.isActive, true)),
      columns: { id: true, name: true, description: true, currency: true },
    });
    if (!menu) return reply.status(404).send({ error: 'Menu not found' });

    const categories = await db.query.posCategories.findMany({
      where: and(eq(posCategories.menuId, menuId), isNull(posCategories.deletedAt)),
      orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)],
      columns: { id: true, name: true, description: true, color: true, sortOrder: true },
    });

    // Fetch all items for all categories in one query, then filter in-memory
    const catIds = categories.map((c) => c.id);
    const allItems = catIds.length > 0
      ? await db.query.posItems.findMany({
          where: and(
            inArray(posItems.categoryId, catIds),
            isNull(posItems.deletedAt),
            eq(posItems.isAvailable, true),
            // Auto-hide: exclude items where autoHideWhenEmpty=true AND inventoryCount=0
            or(
              ne(posItems.autoHideWhenEmpty, true),
              ne(posItems.inventoryCount!, 0),
            ),
          ),
          orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)],
          columns: {
            id: true, categoryId: true, name: true, nameI18n: true,
            description: true, descriptionI18n: true, priceCents: true,
            imageUrl: true, tags: true, allergens: true, nutritionInfo: true,
          },
        })
      : [];

    const itemsByCat = new Map<string, typeof allItems>();
    for (const item of allItems) {
      const list = itemsByCat.get(item.categoryId) ?? [];
      list.push(item);
      itemsByCat.set(item.categoryId, list);
    }

    const result = {
      menu,
      categories: categories
        .map((cat) => ({ ...cat, items: itemsByCat.get(cat.id) ?? [] }))
        .filter((cat) => cat.items.length > 0),
    };
    return reply.send(result);
  });

  // ─── Menu PATCH / DELETE ─────────────────────────────────────────────────────

  app.patch('/mgmt/menus/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; description?: string | null; isActive?: boolean; currency?: string };
    const [updated] = await db
      .update(posMenus)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(posMenus.id, id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Menu not found' });
    return reply.send(updated);
  });

  app.delete('/mgmt/menus/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.update(posMenus).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(posMenus.id, id));
    return reply.status(204).send();
  });

  // ─── Category PATCH / DELETE ─────────────────────────────────────────────────

  app.patch('/mgmt/categories/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; description?: string | null; color?: string | null; sortOrder?: number };
    const [updated] = await db
      .update(posCategories)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(posCategories.id, id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Category not found' });
    return reply.send(updated);
  });

  app.delete('/mgmt/categories/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.update(posCategories).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(posCategories.id, id));
    return reply.status(204).send();
  });

  // ─── POS image upload ────────────────────────────────────────────────────────

  app.post('/mgmt/upload-image', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No file provided' });

    const mime = data.mimetype;
    if (!mime.startsWith('image/')) return reply.status(400).send({ error: 'Only image files are allowed' });

    const ext = path.extname(data.filename) || '.jpg';
    const fileId = crypto.randomUUID();
    const relDir = path.join(user.orgId, 'pos');
    const relPath = path.join(relDir, `${fileId}${ext}`);
    const absDir = path.resolve(STORAGE_ROOT, relDir);
    const absPath = path.resolve(STORAGE_ROOT, relPath);

    await fs.mkdir(absDir, { recursive: true });

    let fileSize = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
      fileSize += chunk.length;
      if (fileSize > 5 * 1024 * 1024) {
        return reply.status(413).send({ error: 'Image too large (max 5 MB)' });
      }
    }
    await fs.writeFile(absPath, Buffer.concat(chunks));

    const imageUrl = `/pos/image/${user.orgId}/pos/${fileId}${ext}`;
    return reply.send({ imageUrl });
  });

  // Serve POS images
  app.get('/image/*', async (req, reply) => {
    const wildcard = (req.params as { '*': string })['*'];
    if (!wildcard || wildcard.includes('..')) return reply.status(400).send({ error: 'Invalid path' });
    const absPath = path.resolve(STORAGE_ROOT, wildcard);
    // Ensure resolved path is inside STORAGE_ROOT
    if (!absPath.startsWith(path.resolve(STORAGE_ROOT))) return reply.status(403).send({ error: 'Forbidden' });
    try { await fs.access(absPath); } catch { return reply.status(404).send({ error: 'Not found' }); }
    const stat = await fs.stat(absPath);
    const ext = path.extname(absPath).toLowerCase();
    const mimeMap: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    reply.header('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
    reply.header('Content-Length', stat.size);
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(createReadStream(absPath));
  });

  // ─── Orders management (session auth — for portal views) ────────────────────

  app.get('/mgmt/orders', async (req, reply) => {
    const auth = await requireWaiterOrSession(req, reply);
    if (!auth) return;
    const { workspaceId, status } = req.query as { workspaceId?: string; status?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const requestedStatuses = status
      ? status.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const orders = await db.query.posOrders.findMany({
      where: and(
        eq(posOrders.workspaceId, workspaceId),
        eq(posOrders.orgId, auth.orgId),
        requestedStatuses.length > 0 ? inArray(posOrders.status, requestedStatuses as string[]) : undefined,
      ),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    return reply.send(await hydrateOrders(orders));
  });

  app.get('/mgmt/orders/open/list', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const orders = await db.query.posOrders.findMany({
      where: and(
        eq(posOrders.workspaceId, workspaceId),
        eq(posOrders.orgId, user.orgId),
        inArray(posOrders.status, [...VALID_ACTIVE_STATUSES]),
      ),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    return reply.send(await hydrateOrders(orders));
  });

  app.get('/mgmt/orders/completed/list', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const orders = await db.query.posOrders.findMany({
      where: and(
        eq(posOrders.workspaceId, workspaceId),
        eq(posOrders.orgId, user.orgId),
        eq(posOrders.status, 'completed'),
      ),
      orderBy: (t, { desc }) => [desc(t.completedAt), desc(t.createdAt)],
    });

    return reply.send(await hydrateOrders(orders));
  });

  app.get('/mgmt/orders/in-kitchen/list', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const orders = await db.query.posOrders.findMany({
      where: and(
        eq(posOrders.workspaceId, workspaceId),
        eq(posOrders.orgId, user.orgId),
        inArray(posOrders.status, ['pending', 'preparing', 'ready']),
      ),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    return reply.send(await hydrateOrders(orders));
  });

  app.get('/mgmt/orders/table/:tableId/current', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { tableId } = req.params as { tableId: string };
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const order = await db.query.posOrders.findFirst({
      where: and(
        eq(posOrders.workspaceId, workspaceId),
        eq(posOrders.orgId, user.orgId),
        eq(posOrders.deviceId, tableId),
        inArray(posOrders.status, [...VALID_ACTIVE_STATUSES]),
      ),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    if (!order) return reply.send(null);
    const [hydrated] = await hydrateOrders([order]);
    return reply.send(hydrated ?? null);
  });

  app.get('/mgmt/orders/by-number/:orderNumber', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { orderNumber } = req.params as { orderNumber: string };
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const parsedOrderNumber = Number(orderNumber);
    if (!Number.isInteger(parsedOrderNumber) || parsedOrderNumber <= 0) {
      return reply.status(400).send({ error: 'Invalid order number' });
    }

    const order = await db.query.posOrders.findFirst({
      where: and(
        eq(posOrders.workspaceId, workspaceId),
        eq(posOrders.orgId, user.orgId),
        eq(posOrders.orderNumber, parsedOrderNumber),
      ),
    });
    if (!order) return reply.status(404).send({ error: 'Order not found' });

    const [hydrated] = await hydrateOrders([order]);
    return reply.send(hydrated);
  });

  app.get('/mgmt/orders/stats/summary', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, from, to } = req.query as { workspaceId?: string; from?: string; to?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
    const toDate = to ? new Date(to) : new Date();

    const rows = await db
      .select({
        totalOrders: sql<number>`count(*)`,
        pendingOrders: sql<number>`count(*) filter (where ${posOrders.status} = 'pending')`,
        preparingOrders: sql<number>`count(*) filter (where ${posOrders.status} = 'preparing')`,
        readyOrders: sql<number>`count(*) filter (where ${posOrders.status} = 'ready')`,
        completedOrders: sql<number>`count(*) filter (where ${posOrders.status} = 'completed')`,
        cancelledOrders: sql<number>`count(*) filter (where ${posOrders.status} = 'cancelled')`,
        revenueCents: sql<number>`coalesce(sum(case when ${posOrders.status} = 'completed' then ${posOrders.totalCents} else 0 end), 0)`,
        avgTicketCents: sql<number>`coalesce(avg(case when ${posOrders.status} = 'completed' then ${posOrders.totalCents} end), 0)`,
      })
      .from(posOrders)
      .where(and(
        eq(posOrders.workspaceId, workspaceId),
        eq(posOrders.orgId, user.orgId),
        gte(posOrders.createdAt, fromDate),
        lte(posOrders.createdAt, toDate),
      ));

    const summary = rows[0];
    return reply.send({
      totalOrders: Number(summary?.totalOrders ?? 0),
      pendingOrders: Number(summary?.pendingOrders ?? 0),
      preparingOrders: Number(summary?.preparingOrders ?? 0),
      readyOrders: Number(summary?.readyOrders ?? 0),
      completedOrders: Number(summary?.completedOrders ?? 0),
      cancelledOrders: Number(summary?.cancelledOrders ?? 0),
      revenueCents: Number(summary?.revenueCents ?? 0),
      avgTicketCents: Number(summary?.avgTicketCents ?? 0),
    });
  });

  app.get('/mgmt/orders/stats/timing-metrics', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, from, to } = req.query as { workspaceId?: string; from?: string; to?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
    const toDate = to ? new Date(to) : new Date();

    const [completed, active] = await Promise.all([
      db
        .select({
          completedCount: sql<number>`count(*)`,
          avgCompletionMinutes: sql<number>`coalesce(avg(extract(epoch from (${posOrders.completedAt} - ${posOrders.createdAt})) / 60.0), 0)`,
          medianCompletionMinutes: sql<number>`coalesce(percentile_cont(0.5) within group (order by extract(epoch from (${posOrders.completedAt} - ${posOrders.createdAt})) / 60.0), 0)`,
        })
        .from(posOrders)
        .where(and(
          eq(posOrders.workspaceId, workspaceId),
          eq(posOrders.orgId, user.orgId),
          eq(posOrders.status, 'completed'),
          sql`${posOrders.completedAt} is not null`,
          gte(posOrders.createdAt, fromDate),
          lte(posOrders.createdAt, toDate),
        )),
      db
        .select({
          activeCount: sql<number>`count(*)`,
          avgActiveMinutes: sql<number>`coalesce(avg(extract(epoch from (now() - ${posOrders.createdAt})) / 60.0), 0)`,
        })
        .from(posOrders)
        .where(and(
          eq(posOrders.workspaceId, workspaceId),
          eq(posOrders.orgId, user.orgId),
          inArray(posOrders.status, [...VALID_ACTIVE_STATUSES]),
        )),
    ]);

    return reply.send({
      completedCount: Number(completed[0]?.completedCount ?? 0),
      avgCompletionMinutes: Number(completed[0]?.avgCompletionMinutes ?? 0),
      medianCompletionMinutes: Number(completed[0]?.medianCompletionMinutes ?? 0),
      activeCount: Number(active[0]?.activeCount ?? 0),
      avgActiveMinutes: Number(active[0]?.avgActiveMinutes ?? 0),
    });
  });

  app.get('/mgmt/orders/stats/hourly-heatmap', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, from, to } = req.query as { workspaceId?: string; from?: string; to?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
    const toDate = to ? new Date(to) : new Date();

    const rows = await db
      .select({
        weekday: sql<number>`extract(isodow from ${posOrders.createdAt})`,
        hour: sql<number>`extract(hour from ${posOrders.createdAt})`,
        orders: sql<number>`count(*)`,
        revenueCents: sql<number>`coalesce(sum(case when ${posOrders.status} = 'completed' then ${posOrders.totalCents} else 0 end), 0)`,
      })
      .from(posOrders)
      .where(and(
        eq(posOrders.workspaceId, workspaceId),
        eq(posOrders.orgId, user.orgId),
        gte(posOrders.createdAt, fromDate),
        lte(posOrders.createdAt, toDate),
      ))
      .groupBy(sql`extract(isodow from ${posOrders.createdAt})`, sql`extract(hour from ${posOrders.createdAt})`)
      .orderBy(sql`extract(isodow from ${posOrders.createdAt})`, sql`extract(hour from ${posOrders.createdAt})`);

    return reply.send(rows.map((row) => ({
      weekday: Number(row.weekday),
      hour: Number(row.hour),
      orders: Number(row.orders),
      revenueCents: Number(row.revenueCents),
    })));
  });

  app.get('/mgmt/orders/:id/history', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const order = await getOrderByIdForOrg(id, user.orgId);
    if (!order) return reply.status(404).send({ error: 'Order not found' });

    const [hydrated, payments] = await Promise.all([
      hydrateOrders([order]),
      db.query.posPayments.findMany({
        where: eq(posPayments.orderId, id),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
      }),
    ]);

    const history = [
      { type: 'created', at: order.createdAt, label: 'Order created' },
      ...(order.completedAt ? [{ type: 'completed', at: order.completedAt, label: 'Order completed' }] : []),
      ...(order.cancelledAt ? [{ type: 'cancelled', at: order.cancelledAt, label: 'Order cancelled' }] : []),
      ...payments.map((payment) => ({
        type: 'payment',
        at: payment.createdAt,
        label: `Payment recorded (${payment.method})`,
        amountCents: payment.amountCents,
      })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    return reply.send({
      order: hydrated[0],
      payments,
      history,
    });
  });

  app.get('/mgmt/orders/:id', async (req, reply) => {
    const auth = await requireWaiterOrSession(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };

    const order = await getOrderByIdForOrg(id, auth.orgId);
    if (!order) return reply.status(404).send({ error: 'Order not found' });

    const [hydrated] = await hydrateOrders([order]);
    return reply.send(hydrated);
  });

  app.patch('/mgmt/orders/:id/status', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const parsed = UpdateOrderStatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid status' });

    const updated = await transitionOrderStatus(id, user.orgId, parsed.data.status);

    if (!updated) return reply.status(404).send({ error: 'Order not found' });
    broadcastKitchenEvent(updated.workspaceId, { type: 'order_updated', orderId: id, status: updated.status });
    return reply.send({ id: updated.id, status: updated.status });
  });

  // ── POST /pos/mgmt/orders ────────────────────────────────────────────────────
  // Session auth — portal/staff creates order manually
  const MgmtCreateOrderSchema = z.object({
    workspaceId:  z.string().uuid(),
    tableId:      z.string().uuid().optional(),
    orderType:    z.enum(['dine-in', 'takeout', 'kiosk']).default('dine-in'),
    customerName: z.string().max(80).optional(),
    notes:        z.string().max(500).optional(),
    items:        z.array(OrderItemInputSchema).min(1).max(50),
  });

  app.post('/mgmt/orders', async (req, reply) => {
    const auth = await requireWaiterOrSession(req, reply);
    if (!auth) return;
    const parsed = MgmtCreateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { workspaceId, tableId, orderType, customerName, notes, items: inputItems } = parsed.data;

    const itemIds = [...new Set(inputItems.map((i) => i.itemId))];
    const menuItems = await db.query.posItems.findMany({
      where: and(inArray(posItems.id, itemIds), eq(posItems.isAvailable, true), isNull(posItems.deletedAt)),
    });
    const itemMap = new Map(menuItems.map((m) => [m.id, m]));
    for (const input of inputItems) {
      if (!itemMap.has(input.itemId)) {
        return reply.status(400).send({ error: `Item ${input.itemId} not found or unavailable` });
      }
    }

    const menu = await db.query.posMenus.findFirst({
      where: and(eq(posMenus.workspaceId, workspaceId), eq(posMenus.isActive, true), isNull(posMenus.deletedAt)),
      columns: { id: true, orgId: true },
    });
    if (!menu) return reply.status(400).send({ error: 'No active menu for this workspace' });
    if (menu.orgId !== auth.orgId) return reply.status(403).send({ error: 'Forbidden' });

    type LineItem = {
      itemId: string; itemName: string; itemPriceCents: number; quantity: number;
      notes: string; selectedModifiers: { groupName: string; optionName: string; priceCents: number }[];
      lineTotalCents: number;
    };
    const lineItems: LineItem[] = inputItems.map((input) => {
      const dbItem = itemMap.get(input.itemId)!;
      const modifierTotal = (input.selectedModifiers ?? []).reduce((s, m) => s + m.priceCents, 0);
      const unitCents = dbItem.priceCents + modifierTotal;
      return {
        itemId: input.itemId, itemName: dbItem.name, itemPriceCents: dbItem.priceCents,
        quantity: input.quantity, notes: input.notes ?? '',
        selectedModifiers: input.selectedModifiers ?? [],
        lineTotalCents: unitCents * input.quantity,
      };
    });
    const totalCents = lineItems.reduce((s, li) => s + li.lineTotalCents, 0);

    const [seq] = await db
      .insert(posOrderSequences)
      .values({ workspaceId, lastOrderNumber: 1 })
      .onConflictDoUpdate({
        target: posOrderSequences.workspaceId,
        set: { lastOrderNumber: sql`${posOrderSequences.lastOrderNumber} + 1`, updatedAt: sql`now()` },
      })
      .returning({ orderNumber: posOrderSequences.lastOrderNumber });

    const orderNotes = [orderType !== 'dine-in' ? orderType : null, notes].filter(Boolean).join(' — ') || null;
    const [order] = await db
      .insert(posOrders)
      .values({
        orgId: menu.orgId, workspaceId,
        tableId:     tableId ?? null,
        orderNumber: seq!.orderNumber, status: 'pending', totalCents,
        customerName: customerName ?? null, notes: orderNotes,
      })
      .returning({ id: posOrders.id, orderNumber: posOrders.orderNumber });

    if (!order) return reply.status(500).send({ error: 'Failed to create order' });

    await db.insert(posOrderItems).values(
      lineItems.map((li) => ({
        orderId: order.id, itemId: li.itemId, itemName: li.itemName,
        itemPriceCents: li.itemPriceCents, quantity: li.quantity,
        notes: li.notes || null, selectedModifiers: li.selectedModifiers,
        lineTotalCents: li.lineTotalCents,
      })),
    );

    // Mark table occupied if tableId provided
    if (tableId) {
      await db.update(posTables).set({ status: 'occupied', updatedAt: new Date() }).where(eq(posTables.id, tableId));
    }

    const responsePayload = {
      id: order.id,
      orderNumber: order.orderNumber,
      totalCents,
      items: lineItems.map((li) => ({ itemName: li.itemName, quantity: li.quantity, lineTotalCents: li.lineTotalCents })),
    };
    broadcastKitchenEvent(workspaceId, { type: 'order_created', order: responsePayload });

    return reply.status(201).send(responsePayload);
  });

  app.post('/mgmt/orders/:id/confirm', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const order = await getOrderByIdForOrg(id, user.orgId);
    if (!order) return reply.status(404).send({ error: 'Order not found' });
    if (order.status !== 'pending') return reply.status(409).send({ error: 'Only pending orders can be confirmed' });

    const updated = await transitionOrderStatus(id, user.orgId, 'preparing');
    broadcastKitchenEvent(order.workspaceId, { type: 'order_confirmed', orderId: id, status: 'preparing' });
    return reply.send({ id: updated!.id, status: updated!.status });
  });

  app.post('/mgmt/orders/:id/cancel', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };

    const order = await getOrderByIdForOrg(id, user.orgId);
    if (!order) return reply.status(404).send({ error: 'Order not found' });
    if (order.status === 'completed' || order.status === 'cancelled') {
      return reply.status(409).send({ error: `Order is already ${order.status}` });
    }

    const updated = await transitionOrderStatus(id, user.orgId, 'cancelled');
    return reply.send({ id: updated!.id, status: updated!.status });
  });

  app.post('/mgmt/orders/:id/items', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const parsed = AddOrderItemsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const order = await getOrderByIdForOrg(id, user.orgId);
    if (!order) return reply.status(404).send({ error: 'Order not found' });
    if (order.status === 'completed' || order.status === 'cancelled') {
      return reply.status(409).send({ error: `Order is already ${order.status}` });
    }

    const itemIds = [...new Set(parsed.data.items.map((item) => item.itemId))];
    const menu = await db.query.posMenus.findFirst({
      where: and(eq(posMenus.workspaceId, order.workspaceId), eq(posMenus.orgId, user.orgId), eq(posMenus.isActive, true), isNull(posMenus.deletedAt)),
      columns: { id: true },
    });
    if (!menu) return reply.status(400).send({ error: 'No active menu for this workspace' });

    const menuItems = await db.query.posItems.findMany({
      where: and(inArray(posItems.id, itemIds), eq(posItems.isAvailable, true), isNull(posItems.deletedAt)),
    });
    const categories = menuItems.length > 0
      ? await db.query.posCategories.findMany({
          where: inArray(posCategories.id, [...new Set(menuItems.map((item) => item.categoryId))]),
        })
      : [];
    const validCategoryIds = new Set(categories.filter((category) => category.menuId === menu.id).map((category) => category.id));
    const itemMap = new Map(menuItems.filter((item) => validCategoryIds.has(item.categoryId)).map((item) => [item.id, item]));
    for (const input of parsed.data.items) {
      if (!itemMap.has(input.itemId)) {
        return reply.status(400).send({ error: `Item ${input.itemId} not found or unavailable` });
      }
    }

    const lineItems = parsed.data.items.map((input) => {
      const dbItem = itemMap.get(input.itemId)!;
      const modifierTotal = (input.selectedModifiers ?? []).reduce((sum, modifier) => sum + modifier.priceCents, 0);
      const unitCents = dbItem.priceCents + modifierTotal;
      return {
        orderId: id,
        itemId: input.itemId,
        itemName: dbItem.name,
        itemPriceCents: dbItem.priceCents,
        quantity: input.quantity,
        notes: input.notes || null,
        selectedModifiers: input.selectedModifiers ?? [],
        lineTotalCents: unitCents * input.quantity,
      };
    });

    await db.insert(posOrderItems).values(lineItems);
    const totalCents = await recalculateOrderTotal(id);
    broadcastKitchenEvent(order.workspaceId, { type: 'item_added', orderId: id });

    return reply.status(201).send({
      orderId: id,
      totalCents,
      itemsAdded: lineItems.length,
    });
  });

  app.post('/mgmt/orders/:orderId/items/:itemId/cancel', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { orderId, itemId } = req.params as { orderId: string; itemId: string };

    const order = await getOrderByIdForOrg(orderId, user.orgId);
    if (!order) return reply.status(404).send({ error: 'Order not found' });
    if (order.status === 'completed' || order.status === 'cancelled') {
      return reply.status(409).send({ error: `Order is already ${order.status}` });
    }

    const lineItem = await db.query.posOrderItems.findFirst({
      where: and(eq(posOrderItems.id, itemId), eq(posOrderItems.orderId, orderId)),
      columns: { id: true },
    });
    if (!lineItem) return reply.status(404).send({ error: 'Order item not found' });

    await db.delete(posOrderItems).where(and(eq(posOrderItems.id, itemId), eq(posOrderItems.orderId, orderId)));
    const totalCents = await recalculateOrderTotal(orderId);

    if (totalCents === 0) {
      const updated = await transitionOrderStatus(orderId, user.orgId, 'cancelled');
      broadcastKitchenEvent(order.workspaceId, { type: 'item_cancelled', orderId, status: 'cancelled' });
      return reply.send({ orderId, itemId, totalCents, status: updated?.status ?? 'cancelled' });
    }

    broadcastKitchenEvent(order.workspaceId, { type: 'item_cancelled', orderId, status: order.status });
    return reply.send({ orderId, itemId, totalCents, status: order.status });
  });

  app.post('/mgmt/orders/:id/mark-paid', async (req, reply) => {
    const auth = await requireWaiterOrSession(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = MarkOrderPaidSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const order = await getOrderByIdForOrg(id, auth.orgId);
    if (!order) return reply.status(404).send({ error: 'Order not found' });
    if (order.status === 'completed' || order.status === 'cancelled') {
      return reply.status(409).send({ error: `Order is already ${order.status}` });
    }

    const tipCents = parsed.data.tipCents ?? 0;
    const taxCents = parsed.data.taxCents ?? 0;
    const totalWithTip = order.totalCents + taxCents + tipCents;
    const amountCents = parsed.data.amountCents ?? totalWithTip;
    if (parsed.data.method === 'cash' && amountCents < totalWithTip) {
      return reply.status(400).send({ error: 'Tendered amount is less than total' });
    }

    const changeCents = parsed.data.method === 'cash' ? Math.max(0, amountCents - totalWithTip) : 0;
    const [payment] = await db
      .insert(posPayments)
      .values({
        orderId: id,
        method: parsed.data.method,
        amountCents,
        tipCents,
        changeCents,
        reference: parsed.data.reference ?? null,
      })
      .returning({ id: posPayments.id });

    await transitionOrderStatus(id, auth.orgId, 'completed');

    // ── Auto-earn loyalty points ──────────────────────────────────────────────
    let loyaltyPointsEarned = 0;
    if (parsed.data.loyaltyCustomerId) {
      const loyaltyConfig = await getLoyaltyConfig(order.workspaceId, auth.orgId);
      if (loyaltyConfig.loyaltyEnabled && loyaltyConfig.loyaltyPointsPerDollar > 0) {
        const customer = await db.query.posLoyaltyCustomers.findFirst({
          where: and(
            eq(posLoyaltyCustomers.id, parsed.data.loyaltyCustomerId),
            eq(posLoyaltyCustomers.workspaceId, order.workspaceId),
            eq(posLoyaltyCustomers.orgId, auth.orgId),
          ),
        });
        if (customer) {
          const earnedPoints = Math.floor((order.totalCents / 100) * loyaltyConfig.loyaltyPointsPerDollar);
          if (earnedPoints > 0) {
            const newPoints = customer.points + earnedPoints;
            const tier = newPoints >= 1000 ? 'gold' : newPoints >= 300 ? 'silver' : 'bronze';
            await db.transaction(async (tx) => {
              await tx.insert(posLoyaltyEvents).values({
                customerId: customer.id,
                orderId: id,
                type: 'earn',
                pointsDelta: earnedPoints,
                notes: 'Auto-earn on payment',
              });
              await tx
                .update(posLoyaltyCustomers)
                .set({ points: newPoints, tier, updatedAt: new Date() })
                .where(eq(posLoyaltyCustomers.id, customer.id));
            });
            loyaltyPointsEarned = earnedPoints;
          }
        }
      }
    }

    return reply.status(201).send({ paymentId: payment!.id, changeCents, orderId: id, loyaltyPointsEarned });
  });

  // ── POST /pos/mgmt/orders/:id/payment ────────────────────────────────────────
  // Session auth — record payment and mark order completed
  const MgmtPaymentSchema = z.object({
    method:      z.enum(['cash', 'card', 'split']).default('cash'),
    amountCents: z.number().int().min(1),
    tipCents:    z.number().int().min(0).default(0),
    reference:   z.string().max(100).optional(),
  });

  app.post('/mgmt/orders/:id/payment', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { id } = req.params as { id: string };
    const parsed = MgmtPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { method, amountCents, tipCents, reference } = parsed.data;

    const order = await getOrderByIdForOrg(id, user.orgId);
    if (!order) return reply.status(404).send({ error: 'Order not found' });
    if (order.status === 'completed' || order.status === 'cancelled') {
      return reply.status(409).send({ error: `Order is already ${order.status}` });
    }

    const totalWithTip = order.totalCents + tipCents;
    const changeCents  = method === 'cash' ? Math.max(0, amountCents - totalWithTip) : 0;

    const [payment] = await db
      .insert(posPayments)
      .values({ orderId: id, method, amountCents, tipCents, changeCents, reference: reference ?? null })
      .returning({ id: posPayments.id });

    await transitionOrderStatus(id, user.orgId, 'completed');

    return reply.status(201).send({ paymentId: payment!.id, changeCents, orderId: id });
  });

  // ─── POS Analytics summary ──────────────────────────────────────────────
  app.get('/analytics/summary', { onRequest: [app.authenticate] }, async (req, reply) => {
    type AuthUser = { sub: string; orgId: string; role: string };
    const user = req.user as AuthUser;

    const { workspaceId, from, to } = req.query as {
      workspaceId?: string;
      from?: string;
      to?: string;
    };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
    const toDate   = to   ? new Date(to)   : new Date();

    // Total orders + revenue in date range
    const rows = await db
      .select({
        total:   sql<number>`count(*)`,
        revenue: sql<number>`coalesce(sum(${posOrders.totalCents}), 0)`,
      })
      .from(posOrders)
      .where(
        and(
          eq(posOrders.workspaceId, workspaceId),
          gte(posOrders.createdAt, fromDate),
          lte(posOrders.createdAt, toDate),
        ),
      );

    const totalOrders  = Number(rows[0]?.total ?? 0);
    const totalRevenue = Number(rows[0]?.revenue ?? 0);
    const avgTicket    = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Orders + revenue grouped by day
    const byDayRows = await db
      .select({
        date:    sql<string>`to_char(date_trunc('day', ${posOrders.createdAt}), 'YYYY-MM-DD')`,
        orders:  sql<number>`count(*)`,
        revenue: sql<number>`coalesce(sum(${posOrders.totalCents}), 0)`,
      })
      .from(posOrders)
      .where(
        and(
          eq(posOrders.workspaceId, workspaceId),
          gte(posOrders.createdAt, fromDate),
          lte(posOrders.createdAt, toDate),
        ),
      )
      .groupBy(sql`date_trunc('day', ${posOrders.createdAt})`)
      .orderBy(sql`date_trunc('day', ${posOrders.createdAt})`);

    // Top items by qty sold
    const topItemRows = await db
      .select({
        name:    posItems.name,
        qty:     sql<number>`sum(${posOrderItems.quantity})`,
        revenue: sql<number>`sum(${posOrderItems.lineTotalCents})`,
      })
      .from(posOrderItems)
      .innerJoin(posOrders, eq(posOrderItems.orderId, posOrders.id))
      .leftJoin(posItems, eq(posOrderItems.itemId, posItems.id))
      .where(
        and(
          eq(posOrders.workspaceId, workspaceId),
          gte(posOrders.createdAt, fromDate),
          lte(posOrders.createdAt, toDate),
        ),
      )
      .groupBy(posItems.id, posItems.name)
      .orderBy(sql`sum(${posOrderItems.quantity}) desc`)
      .limit(10);

    return reply.send({
      totalOrders,
      totalRevenue,
      avgTicket,
      byDay:    byDayRows.map((r) => ({ date: r.date, orders: Number(r.orders), revenue: Number(r.revenue) })),
      topItems: topItemRows.map((r) => ({ name: r.name, qty: Number(r.qty), revenue: Number(r.revenue) })),
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // PHASE 6 ROUTES
  // ══════════════════════════════════════════════════════════════════════════════

  // ── Inventory ────────────────────────────────────────────────────────────────────

  app.get('/mgmt/inventory', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    const items = await db.query.posInventoryItems.findMany({
      where: and(eq(posInventoryItems.workspaceId, workspaceId), eq(posInventoryItems.orgId, user.orgId), eq(posInventoryItems.isActive, true)),
      orderBy: (t, { asc }) => [asc(t.name)],
    });
    return reply.send(items);
  });

  app.post('/mgmt/inventory', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId: string; name: string; unit?: string; quantity?: number; reorderPoint?: number; costCents?: number; sku?: string; supplier?: string; notes?: string };
    const [item] = await db.insert(posInventoryItems).values({
      orgId: user.orgId, workspaceId: body.workspaceId, name: body.name,
      unit: body.unit ?? 'unit', quantity: body.quantity ?? 0,
      reorderPoint: body.reorderPoint ?? 0, costCents: body.costCents ?? 0,
      sku: body.sku ?? null, supplier: body.supplier ?? null, notes: body.notes ?? null,
    }).returning();
    return reply.status(201).send(item);
  });

  app.patch('/mgmt/inventory/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; unit?: string; quantity?: number; reorderPoint?: number; costCents?: number; sku?: string | null; supplier?: string | null; notes?: string | null };
    const [updated] = await db.update(posInventoryItems).set({ ...body, updatedAt: new Date() }).where(eq(posInventoryItems.id, id)).returning();
    if (!updated) return reply.status(404).send({ error: 'Item not found' });
    return reply.send(updated);
  });

  app.delete('/mgmt/inventory/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.update(posInventoryItems).set({ isActive: false, updatedAt: new Date() }).where(eq(posInventoryItems.id, id));
    return reply.status(204).send();
  });

  // ── Employees ───────────────────────────────────────────────────────────────────

  app.get('/mgmt/employees', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    const emps = await db.query.posEmployees.findMany({
      where: and(eq(posEmployees.workspaceId, workspaceId), eq(posEmployees.orgId, user.orgId), eq(posEmployees.isActive, true)),
      orderBy: (t, { asc }) => [asc(t.name)],
    });
    // Never send pinHash to client
    return reply.send(emps.map(({ pinHash: _ph, ...e }) => e));
  });

  app.post('/mgmt/employees', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId: string; name: string; email?: string; phone?: string; role?: string; hiredAt?: string };
    const [emp] = await db.insert(posEmployees).values({
      orgId: user.orgId, workspaceId: body.workspaceId, name: body.name,
      email: body.email ?? null, phone: body.phone ?? null,
      role: body.role ?? 'staff',
      hiredAt: body.hiredAt ? new Date(body.hiredAt) : null,
    }).returning();
    const { pinHash: _ph, ...safeEmp } = emp!;
    return reply.status(201).send(safeEmp);
  });

  app.patch('/mgmt/employees/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; email?: string | null; phone?: string | null; role?: string; isActive?: boolean };
    const [updated] = await db.update(posEmployees).set({ ...body, updatedAt: new Date() }).where(eq(posEmployees.id, id)).returning();
    if (!updated) return reply.status(404).send({ error: 'Employee not found' });
    const { pinHash: _ph, ...safeEmp } = updated;
    return reply.send(safeEmp);
  });

  app.delete('/mgmt/employees/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.update(posEmployees).set({ isActive: false, updatedAt: new Date() }).where(eq(posEmployees.id, id));
    return reply.status(204).send();
  });

  // Clock in/out
  app.post('/mgmt/employees/:id/clock', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { workspaceId } = req.body as { workspaceId: string };
    // Find open entry (clocked in, not yet out)
    const open = await db.query.posTimeEntries.findFirst({
      where: and(eq(posTimeEntries.employeeId, id), isNull(posTimeEntries.clockedOutAt)),
    });
    if (open) {
      // Clock out
      const [entry] = await db.update(posTimeEntries).set({ clockedOutAt: new Date() }).where(eq(posTimeEntries.id, open.id)).returning();
      return reply.send({ action: 'clock-out', entry });
    } else {
      // Clock in
      const [entry] = await db.insert(posTimeEntries).values({ employeeId: id, workspaceId }).returning();
      return reply.status(201).send({ action: 'clock-in', entry });
    }
  });

  app.get('/mgmt/employees/:id/time-entries', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const entries = await db.query.posTimeEntries.findMany({
      where: eq(posTimeEntries.employeeId, id),
      orderBy: (t, { desc }) => [desc(t.clockedInAt)],
    });
    return reply.send(entries);
  });

  // ── Loyalty ─────────────────────────────────────────────────────────────────────

  app.get('/mgmt/loyalty/customers', async (req, reply) => {
    const auth = await requireWaiterOrSession(req, reply);
    if (!auth) return;
    const { workspaceId, q } = req.query as { workspaceId?: string; q?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    const customers = await db.query.posLoyaltyCustomers.findMany({
      where: and(eq(posLoyaltyCustomers.workspaceId, workspaceId), eq(posLoyaltyCustomers.orgId, auth.orgId)),
      orderBy: (t, { desc }) => [desc(t.points)],
      limit: q ? 20 : 100,
    });
    const result = q
      ? customers.filter((c) => c.phone?.includes(q) || c.email?.includes(q) || c.name.toLowerCase().includes(q.toLowerCase()))
      : customers;
    return reply.send(result);
  });

  app.post('/mgmt/loyalty/customers', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId: string; name: string; phone?: string; email?: string };
    const [customer] = await db.insert(posLoyaltyCustomers).values({
      orgId: user.orgId, workspaceId: body.workspaceId,
      name: body.name, phone: body.phone ?? null, email: body.email ?? null,
    }).returning();
    return reply.status(201).send(customer);
  });

  app.patch('/mgmt/loyalty/customers/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; phone?: string | null; email?: string | null; tier?: string };
    const [updated] = await db.update(posLoyaltyCustomers).set({ ...body, updatedAt: new Date() }).where(eq(posLoyaltyCustomers.id, id)).returning();
    if (!updated) return reply.status(404).send({ error: 'Customer not found' });
    return reply.send(updated);
  });

  // Earn / redeem points
  app.post('/mgmt/loyalty/points', { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = req.body as { customerId: string; type: 'earn' | 'redeem' | 'adjust'; pointsDelta: number; orderId?: string; notes?: string };
    const customer = await db.query.posLoyaltyCustomers.findFirst({ where: eq(posLoyaltyCustomers.id, body.customerId) });
    if (!customer) return reply.status(404).send({ error: 'Customer not found' });

    const newPoints = Math.max(0, customer.points + body.pointsDelta);
    const tier = newPoints >= 1000 ? 'gold' : newPoints >= 300 ? 'silver' : 'bronze';

    await db.transaction(async (tx) => {
      await tx.insert(posLoyaltyEvents).values({
        customerId: body.customerId,
        orderId: body.orderId ?? null,
        type: body.type,
        pointsDelta: body.pointsDelta,
        notes: body.notes ?? null,
      });
      await tx.update(posLoyaltyCustomers).set({ points: newPoints, tier, updatedAt: new Date() }).where(eq(posLoyaltyCustomers.id, body.customerId));
    });

    return reply.send({ customerId: body.customerId, newPoints, tier });
  });

  // ── Expenses ────────────────────────────────────────────────────────────────────

  app.get('/mgmt/expenses', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, from, to } = req.query as { workspaceId?: string; from?: string; to?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
    const toDate   = to   ? new Date(to)   : new Date();
    const expenses = await db.query.posExpenses.findMany({
      where: and(
        eq(posExpenses.workspaceId, workspaceId),
        eq(posExpenses.orgId, user.orgId),
        gte(posExpenses.expenseDate, fromDate),
        lte(posExpenses.expenseDate, toDate),
      ),
      orderBy: (t, { desc }) => [desc(t.expenseDate)],
    });
    return reply.send(expenses);
  });

  app.post('/mgmt/expenses', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as { workspaceId: string; category?: string; description: string; amountCents: number; expenseDate?: string; receiptUrl?: string };
    const [expense] = await db.insert(posExpenses).values({
      orgId: user.orgId, workspaceId: body.workspaceId,
      category: body.category ?? 'other', description: body.description,
      amountCents: body.amountCents,
      expenseDate: body.expenseDate ? new Date(body.expenseDate) : new Date(),
      receiptUrl: body.receiptUrl ?? null,
    }).returning();
    return reply.status(201).send(expense);
  });

  app.patch('/mgmt/expenses/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { category?: string; description?: string; amountCents?: number; expenseDate?: string; receiptUrl?: string | null };
    const [updated] = await db.update(posExpenses).set({
      ...body,
      expenseDate: body.expenseDate ? new Date(body.expenseDate) : undefined,
      updatedAt: new Date(),
    }).where(eq(posExpenses.id, id)).returning();
    if (!updated) return reply.status(404).send({ error: 'Expense not found' });
    return reply.send(updated);
  });

  app.delete('/mgmt/expenses/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(posExpenses).where(eq(posExpenses.id, id));
    return reply.status(204).send();
  });

  // ── Purchase Orders ─────────────────────────────────────────────────────────────

  app.get('/mgmt/purchase-orders', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    const pos = await db.query.posPurchaseOrders.findMany({
      where: and(eq(posPurchaseOrders.workspaceId, workspaceId), eq(posPurchaseOrders.orgId, user.orgId)),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
    return reply.send(pos);
  });

  app.post('/mgmt/purchase-orders', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = req.body as {
      workspaceId: string; supplier: string; notes?: string; expectedAt?: string;
      items: { name: string; quantity: number; unit: string; unitCostCents: number }[];
    };
    const totalCents = body.items.reduce((s, i) => s + i.unitCostCents * i.quantity, 0);

    // Auto-increment PO number per workspace
    const latest = await db.query.posPurchaseOrders.findFirst({
      where: eq(posPurchaseOrders.workspaceId, body.workspaceId),
      orderBy: (t, { desc }) => [desc(t.poNumber)],
      columns: { poNumber: true },
    });
    const poNumber = (latest?.poNumber ?? 0) + 1;

    const items = body.items.map((i) => ({ ...i, totalCents: i.unitCostCents * i.quantity }));
    const [po] = await db.insert(posPurchaseOrders).values({
      orgId: user.orgId, workspaceId: body.workspaceId, poNumber,
      supplier: body.supplier, items, totalCents,
      expectedAt: body.expectedAt ? new Date(body.expectedAt) : null,
      notes: body.notes ?? null,
    }).returning();
    return reply.status(201).send(po);
  });

  app.patch('/mgmt/purchase-orders/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { status?: string; notes?: string | null; expectedAt?: string | null; deliveredAt?: string | null };
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined)     set['status'] = body.status;
    if (body.notes !== undefined)      set['notes'] = body.notes;
    if (body.expectedAt !== undefined) set['expectedAt'] = body.expectedAt ? new Date(body.expectedAt) : null;
    if (body.deliveredAt !== undefined) set['deliveredAt'] = body.deliveredAt ? new Date(body.deliveredAt) : null;
    const [updated] = await db.update(posPurchaseOrders).set(set).where(eq(posPurchaseOrders.id, id)).returning();
    if (!updated) return reply.status(404).send({ error: 'Purchase order not found' });
    return reply.send(updated);
  });

  // ─── Display Tokens ─────────────────────────────────────────────────────────
  // Generate JWT tokens for public-display devices (kiosk screens, kitchen displays)
  // that cannot use session cookies. Tokens are workspace-scoped and stored in
  // posRestaurants.settings.displayTokens so they can be revoked by regeneration.

  app.get('/mgmt/display-tokens', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const restaurant = await db.query.posRestaurants.findFirst({
      where: and(eq(posRestaurants.workspaceId, workspaceId), eq(posRestaurants.orgId, user.orgId)),
      columns: { settings: true },
    });
    const tokens = getSettingsObject(getSettingsObject(restaurant?.settings)['displayTokens']);

    return reply.send({
      kiosk:   typeof tokens['kiosk']   === 'string' ? tokens['kiosk']   : null,
      kitchen: typeof tokens['kitchen'] === 'string' ? tokens['kitchen'] : null,
    });
  });

  app.post('/mgmt/display-tokens', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = DisplayTokenTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { displayType, workspaceId } = parsed.data;

    const token = app.jwt.sign(
      { sub: workspaceId, type: 'display', displayType, orgId: user.orgId, workspaceId },
      { expiresIn: '87600h' },  // 10 years
    );

    await upsertRestaurantSettings(workspaceId, user.orgId, {
      displayTokens: {
        ...getSettingsObject(
          getSettingsObject(
            (await db.query.posRestaurants.findFirst({
              where: and(eq(posRestaurants.workspaceId, workspaceId), eq(posRestaurants.orgId, user.orgId)),
              columns: { settings: true },
            }))?.settings,
          )['displayTokens'],
        ),
        [displayType]: token,
      },
    });

    return reply.status(201).send({ token, displayType });
  });

  // DELETE regenerates (invalidates old, issues new)
  app.delete('/mgmt/display-tokens/:displayType', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { displayType } = req.params as { displayType: string };
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    if (displayType !== 'kiosk' && displayType !== 'kitchen') {
      return reply.status(400).send({ error: 'displayType must be kiosk or kitchen' });
    }

    const token = app.jwt.sign(
      { sub: workspaceId, type: 'display', displayType, orgId: user.orgId, workspaceId },
      { expiresIn: '87600h' },
    );

    const existing = await db.query.posRestaurants.findFirst({
      where: and(eq(posRestaurants.workspaceId, workspaceId), eq(posRestaurants.orgId, user.orgId)),
      columns: { settings: true },
    });
    await upsertRestaurantSettings(workspaceId, user.orgId, {
      displayTokens: {
        ...getSettingsObject(getSettingsObject(existing?.settings)['displayTokens']),
        [displayType]: token,
      },
    });

    return reply.send({ token, displayType });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // UBER EATS INTEGRATION
  // ══════════════════════════════════════════════════════════════════════════════

  // ── GET /pos/mgmt/uber-eats?workspaceId= ─────────────────────────────────────
  app.get('/mgmt/uber-eats', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const restaurant = await db.query.posRestaurants.findFirst({
      where: and(eq(posRestaurants.workspaceId, workspaceId), eq(posRestaurants.orgId, user.orgId)),
      columns: { settings: true },
    });
    const settings     = getSettingsObject(restaurant?.settings);
    const uberSettings = getSettingsObject(settings['uberEats']);
    const connected    = Boolean(uberSettings['connected'] && uberSettings['storeId']);
    const webhookUrl   = `${uberEatsLib.getPublicApiUrl()}/api/v1/pos/uber-eats/webhook`;

    return reply.send({
      connected,
      storeId:      connected ? (uberSettings['storeId']       as string)          : null,
      storeName:    connected ? (uberSettings['storeName']     as string | null)    : null,
      storeAddress: connected ? (uberSettings['storeAddress']  as string | null)    : null,
      autoAccept:   (uberSettings['autoAccept'] as boolean | undefined) ?? true,
      webhookUrl,
    });
  });

  // ── GET /pos/mgmt/uber-eats/connect?workspaceId= ─────────────────────────────
  // Returns { redirectUrl, nexariOrigin? } for the DS to open in a popup.
  // In proxy mode (NEXARI_ADMIN_ORIGIN set) the URL points to nexari.ca which
  // owns the shared Uber Eats OAuth app — only ONE redirect URI needs to be
  // registered. In direct mode it points to Uber's authorize endpoint directly.
  app.get('/mgmt/uber-eats/connect', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, json, returnTo, popup } = req.query as {
      workspaceId?: string; json?: string; returnTo?: string; popup?: string;
    };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    try {
      const nexariAdminOrigin = process.env['NEXARI_ADMIN_ORIGIN'];
      const licCreds = nexariAdminOrigin ? await getLicenseHmacSecret() : null;

      if (nexariAdminOrigin && licCreds) {
        // ── Proxy mode ──────────────────────────────────────────────────────
        const callbackOrigin = new URL(
          process.env['APP_URL'] ?? process.env['API_PUBLIC_URL'] ?? 'http://localhost:5174',
        ).origin;
        const nonce = crypto.randomBytes(16).toString('hex');
        const statePayload = {
          licenseKey: licCreds.licenseKey,
          workspaceId,
          userId: user.sub,
          scope: 'personal' as const,
          provider: 'uber-eats',
          callbackOrigin,
          nonce,
          expiresAt: Date.now() + 10 * 60 * 1000,
        };
        const bodyB64 = Buffer.from(JSON.stringify(statePayload), 'utf8').toString('base64url');
        const sig = crypto.createHmac('sha256', licCreds.hmacSecret).update(bodyB64, 'utf8').digest('base64url');
        const proxyUrl = `${nexariAdminOrigin}/oauth/uber-eats/start?state=${bodyB64}.${sig}`;
        if (json === '1') return reply.send({ redirectUrl: proxyUrl, nexariOrigin: nexariAdminOrigin });
        return reply.redirect(proxyUrl, 302);
      }

      // ── Direct mode ─────────────────────────────────────────────────────
      const state = crypto.randomUUID();
      const url   = await uberEatsLib.buildAuthorizeUrl(state, {
        workspaceId,
        orgId:    user.orgId,
        ...(returnTo ? { returnTo } : {}),
        popup:    popup === '1',
      });
      if (json === '1') return reply.send({ redirectUrl: url });
      return reply.redirect(url, 302);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.status(500).send({ error: `Failed to initiate Uber OAuth: ${message}` });
    }
  });

  // ── POST /pos/uber-eats/relay ─────────────────────────────────────────────
  // Called from the DS after receiving an `oauth_relay` postMessage from nexari.ca.
  // Decrypts the merchant token, fetches the store list, stores a session, and
  // returns { session } so the DS can continue the existing store-select wizard.
  app.post('/uber-eats/relay', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { encrypted } = req.body as { encrypted?: string };
    if (!encrypted) return reply.status(400).send({ error: 'encrypted payload required' });

    const licCreds = await getLicenseHmacSecret();
    if (!licCreds) return reply.status(503).send({ error: 'License not configured — relay unavailable' });

    const relayKey = Buffer.from(
      crypto.createHmac('sha256', licCreds.hmacSecret).update('oauth-relay-v1', 'utf8').digest(),
    );

    let payload: { type: string; provider: string; workspaceId: string; merchantToken: string; refreshToken?: string; expiresIn?: number };
    try {
      const parts = encrypted.split(':');
      if (parts.length !== 3) throw new Error('Malformed');
      const iv = Buffer.from(parts[0]!, 'base64url');
      const tag = Buffer.from(parts[1]!, 'base64url');
      const cipherBuf = Buffer.from(parts[2]!, 'base64url');
      const decipher = crypto.createDecipheriv('aes-256-gcm', relayKey, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(cipherBuf), decipher.final()]).toString('utf8');
      payload = JSON.parse(plain);
    } catch {
      return reply.status(400).send({ error: 'Payload decryption failed' });
    }

    if (payload.type !== 'oauth_relay' || payload.provider !== 'uber-eats') {
      return reply.status(400).send({ error: 'Invalid payload' });
    }

    try {
      const stores = await uberEatsLib.getMerchantStores(payload.merchantToken);
      const sessionToken = crypto.randomUUID();
      await uberEatsLib.storeOAuthSession(sessionToken, {
        workspaceId:   payload.workspaceId,
        orgId:         user.orgId,
        merchantToken: payload.merchantToken,
        stores,
      });
      return reply.send({ session: sessionToken });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ error: `Uber Eats relay failed: ${msg}` });
    }
  });

  // ── GET /pos/uber-eats/oauth/callback ────────────────────────────────────────
  // Public — Uber redirects here after merchant authorizes
  app.get('/uber-eats/oauth/callback', async (req, reply) => {
    const { code, state, error: oauthError } = req.query as {
      code?: string; state?: string; error?: string;
    };
    const dsFallback = process.env['DS_BASE_URL'] ?? '';

    if (oauthError || !code || !state) {
      return reply.redirect(`${dsFallback}/?uber_error=access_denied`, 302);
    }

    try {
      const context = await uberEatsLib.consumeOAuthState(state);
      if (!context) {
        return reply.redirect(`${dsFallback}/?uber_error=invalid_state`, 302);
      }

      const tokenResp = await uberEatsLib.exchangeCode(code);
      const stores    = await uberEatsLib.getMerchantStores(tokenResp.access_token);

      const sessionToken = crypto.randomUUID();
      await uberEatsLib.storeOAuthSession(sessionToken, {
        workspaceId:   context.workspaceId,
        orgId:         context.orgId,
        merchantToken: tokenResp.access_token,
        stores,
      });

      // Determine redirect destination based on returnTo / popup context
      if (context.returnTo === 'settings') {
        const target = new URL(`${dsFallback}/settings`);
        target.searchParams.set('section',      'pos-uber-eats');
        target.searchParams.set('uber_session', sessionToken);
        if (context.popup) target.searchParams.set('popup', '1');
        return reply.redirect(target.toString(), 302);
      }
      const target = new URL(`${dsFallback}/workspaces/${context.workspaceId}/pos/kiosk`);
      target.searchParams.set('uber_session', sessionToken);
      return reply.redirect(target.toString(), 302);
    } catch (err) {
      console.error('[uber-oauth-callback]', err);
      return reply.redirect(`${dsFallback}/?uber_error=server_error`, 302);
    }
  });

  // ── GET /pos/mgmt/uber-eats/stores?session= ──────────────────────────────────
  // Returns stores from a pending OAuth session
  app.get('/mgmt/uber-eats/stores', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { session } = req.query as { session?: string };
    if (!session) return reply.status(400).send({ error: 'session required' });

    const oauthSession = await uberEatsLib.getOAuthSession(session);
    if (!oauthSession || oauthSession.orgId !== user.orgId) {
      return reply.status(404).send({ error: 'Session expired or not found' });
    }
    return reply.send({ stores: oauthSession.stores });
  });

  // ── POST /pos/mgmt/uber-eats/activate ────────────────────────────────────────
  // Provisions a specific store and saves connection to workspace settings
  const ActivateUberEatsSchema = z.object({
    session: z.string().uuid(),
    storeId: z.string().min(1),
  });

  app.post('/mgmt/uber-eats/activate', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user   = req.user as AuthUser;
    const parsed = ActivateUberEatsSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });

    const oauthSession = await uberEatsLib.getOAuthSession(parsed.data.session);
    if (!oauthSession || oauthSession.orgId !== user.orgId) {
      return reply.status(404).send({ error: 'Session expired or not found' });
    }

    const { workspaceId, merchantToken, stores } = oauthSession;
    const store = stores.find((s) => s.store_id === parsed.data.storeId);
    if (!store) return reply.status(400).send({ error: 'Store not found in session' });

    const storeAddress = [store.location.address, store.location.city]
      .filter(Boolean).join(', ');

    await uberEatsLib.provisionStore(merchantToken, store.store_id, workspaceId);
    await upsertRestaurantSettings(workspaceId, user.orgId, {
      uberEats: {
        connected:     true,
        storeId:       store.store_id,
        storeName:     store.name,
        storeAddress,
        autoAccept:    true,
        merchantToken: merchantToken,
      },
    });
    await uberEatsLib.deleteOAuthSession(parsed.data.session);
    return reply.send({ ok: true, storeName: store.name, storeAddress });
  });

  // ── PUT /pos/mgmt/uber-eats/settings ─────────────────────────────────────────
  // Update autoAccept and other non-credential settings
  const UberEatsSettingsSchema = z.object({
    workspaceId: z.string().uuid(),
    autoAccept:  z.boolean(),
  });

  app.put('/mgmt/uber-eats/settings', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user   = req.user as AuthUser;
    const parsed = UberEatsSettingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });

    const { workspaceId, autoAccept } = parsed.data;
    const restaurant = await db.query.posRestaurants.findFirst({
      where: and(eq(posRestaurants.workspaceId, workspaceId), eq(posRestaurants.orgId, user.orgId)),
      columns: { settings: true },
    });
    const existing = getSettingsObject(getSettingsObject(restaurant?.settings)['uberEats']);
    await upsertRestaurantSettings(workspaceId, user.orgId, {
      uberEats: { ...existing, autoAccept },
    });
    return reply.send({ ok: true });
  });

  // ── DELETE /pos/mgmt/uber-eats?workspaceId= ───────────────────────────────────
  // Disconnect: deprovision from Uber and clear workspace settings
  app.delete('/mgmt/uber-eats', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const restaurant = await db.query.posRestaurants.findFirst({
      where: and(eq(posRestaurants.workspaceId, workspaceId), eq(posRestaurants.orgId, user.orgId)),
      columns: { settings: true },
    });
    const uberEatsSettings = getSettingsObject(getSettingsObject(restaurant?.settings)['uberEats']);
    const storeId           = uberEatsSettings['storeId']       as string | undefined;
    const merchantToken     = uberEatsSettings['merchantToken'] as string | undefined;

    if (storeId) {
      try {
        if (merchantToken) {
          await uberEatsLib.deprovisionStore(merchantToken, storeId);
        } else {
          console.warn('[uber-eats] Cannot deprovision from Uber: merchant token unavailable, clearing local settings only');
        }
      } catch (err) {
        console.error('[uber-eats] deprovisionStore error:', err);
      }
    }
    await upsertRestaurantSettings(workspaceId, user.orgId, { uberEats: {} });
    return reply.send({ ok: true });
  });

  // ── POST /pos/uber-eats/webhook (public, scoped for raw body capture) ─────────
  await app.register(async (webhookScope) => {
    webhookScope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (req, body, done) => {
        (req as typeof req & { rawBody: Buffer }).rawBody = body as Buffer;
        try {
          done(null, JSON.parse((body as Buffer).toString()));
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );

    webhookScope.post('/uber-eats/webhook', async (req, reply) => {
      const sig     = req.headers['x-uber-signature'] as string | undefined;
      const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;

      if (!sig || !rawBody) {
        return reply.status(400).send({ error: 'Missing signature or body' });
      }
      if (!await uberEatsLib.verifyWebhookSignature(rawBody, sig)) {
        return reply.status(401).send({ error: 'Invalid webhook signature' });
      }

      const event = req.body as {
        event_type?: string;
        resource_id?: string;
        user_id?: string;
        meta?: { resource_id?: string; user_id?: string };
      };
      const eventType = event.event_type;
      const storeId   = event.user_id ?? event.meta?.user_id;
      const orderId   = event.resource_id ?? event.meta?.resource_id;

      // Fire-and-forget: process webhook after responding 200
      if (storeId && eventType) {
        void processUberWebhookEvent(storeId, eventType, orderId);
      }
      return reply.status(200).send({});
    });

    async function processUberWebhookEvent(
      storeId: string,
      eventType: string,
      uberOrderId: string | undefined,
    ) {
      try {
        const restaurant = await db.query.posRestaurants.findFirst({
          where: sql`(${posRestaurants.settings})::jsonb -> 'uberEats' ->> 'storeId' = ${storeId}`,
          columns: { workspaceId: true, orgId: true, settings: true },
        });
        if (!restaurant) {
          console.warn(`[uber-webhook] No workspace for storeId ${storeId}`);
          return;
        }
        const { workspaceId, orgId } = restaurant;
        const uberSettings = getSettingsObject(getSettingsObject(restaurant.settings)['uberEats']);
        const autoAccept   = (uberSettings['autoAccept'] as boolean | undefined) ?? true;

        if (eventType === 'orders.notification' && uberOrderId) {
          const existing = await db.query.posOrders.findFirst({
            where: and(eq(posOrders.workspaceId, workspaceId), eq(posOrders.externalId, uberOrderId)),
            columns: { id: true },
          });
          if (existing) return; // dedup

          const appToken   = await uberEatsLib.getAppToken();
          const uberOrdRes = await fetch(
            `https://api.uber.com/v1/eats/orders/${encodeURIComponent(uberOrderId)}`,
            { headers: { Authorization: `Bearer ${appToken}` } },
          );
          if (!uberOrdRes.ok) {
            console.error(`[uber-webhook] GET order ${uberOrderId} → ${uberOrdRes.status}`);
            return;
          }
          const uberOrd = await uberOrdRes.json() as {
            id:          string;
            display_id?: string;
            eater?:      { first_name?: string; last_name?: string };
            cart?: {
              items?: Array<{
                title:     string;
                quantity:  number;
                price?:    { unit_price?: { amount?: number } };
                customizations?: Array<{
                  customization_name: string;
                  customization_type: string;
                  quantity:           number;
                  price:              { amount: number };
                }>;
              }>;
            };
          };

          const customerName = [uberOrd.eater?.first_name, uberOrd.eater?.last_name]
            .filter(Boolean).join(' ') || null;
          const displayId    = uberOrd.display_id ?? '';
          const notes        = displayId ? `🚴 Uber #${displayId}` : '🚴 Uber Eats';

          const lineItems = (uberOrd.cart?.items ?? []).map((item) => {
            const unitCents  = Math.round((item.price?.unit_price?.amount ?? 0) * 100);
            const modifiers  = (item.customizations ?? []).map((c) => ({
              groupName:  c.customization_name,
              optionName: c.customization_type,
              priceCents: Math.round(c.price.amount * 100),
            }));
            const modTotal   = modifiers.reduce((sum, m) => sum + m.priceCents, 0);
            return { itemName: item.title, itemPriceCents: unitCents, quantity: item.quantity,
              selectedModifiers: modifiers, lineTotalCents: (unitCents + modTotal) * item.quantity };
          });
          const totalCents = lineItems.reduce((sum, li) => sum + li.lineTotalCents, 0);

          const [seq] = await db
            .insert(posOrderSequences)
            .values({ workspaceId, lastOrderNumber: 1 })
            .onConflictDoUpdate({
              target: posOrderSequences.workspaceId,
              set: { lastOrderNumber: sql`${posOrderSequences.lastOrderNumber} + 1`, updatedAt: sql`now()` },
            })
            .returning({ orderNumber: posOrderSequences.lastOrderNumber });

          const [order] = await db
            .insert(posOrders)
            .values({
              orgId, workspaceId,
              orderNumber:  seq!.orderNumber,
              status:       'pending',
              totalCents,
              customerName,
              notes,
              source:       'uber-eats',
              externalId:   uberOrderId,
            })
            .returning();
          if (!order) return;

          if (lineItems.length > 0) {
            await db.insert(posOrderItems).values(
              lineItems.map((li) => ({
                orderId: order.id, itemName: li.itemName, itemPriceCents: li.itemPriceCents,
                quantity: li.quantity, selectedModifiers: li.selectedModifiers, lineTotalCents: li.lineTotalCents,
              })),
            );
          }

          broadcastKitchenEvent(workspaceId, {
            type: 'order_created',
            order: { id: order.id, orderNumber: order.orderNumber, totalCents,
              status: 'pending', source: 'uber-eats', externalId: uberOrderId, customerName, notes },
          });

          if (autoAccept) {
            const tok = await uberEatsLib.getAppToken();
            await uberEatsLib.acceptOrder(tok, uberOrderId);
          }

        } else if (eventType === 'orders.cancel' && uberOrderId) {
          const ord = await db.query.posOrders.findFirst({
            where: and(eq(posOrders.workspaceId, workspaceId), eq(posOrders.externalId, uberOrderId)),
            columns: { id: true, orgId: true },
          });
          if (!ord) return;
          await transitionOrderStatus(ord.id, ord.orgId, 'cancelled');
          broadcastKitchenEvent(workspaceId, { type: 'order_updated', orderId: ord.id, status: 'cancelled' });

        } else if (eventType === 'store.provisioned') {
          await upsertRestaurantSettings(workspaceId, orgId, {
            uberEats: { ...uberSettings, connected: true },
          });
        } else if (eventType === 'store.deprovisioned') {
          await upsertRestaurantSettings(workspaceId, orgId, {
            uberEats: { ...uberSettings, connected: false },
          });
        } else if (eventType === 'store.menu_refresh_request') {
          // Uber is requesting a full menu re-push for this store
          const uberStoreId = uberSettings['storeId'] as string | undefined;
          if (uberStoreId) {
            const appToken   = await uberEatsLib.getAppToken();
            const menuPayload = await buildUberMenuPayload(workspaceId);
            if (menuPayload) {
              await uberEatsLib.uploadMenu(appToken, uberStoreId, menuPayload);
              console.log(`[uber-webhook] menu refreshed for storeId ${uberStoreId}`);
            } else {
              console.warn(`[uber-webhook] menu_refresh_request: no active menu for workspace ${workspaceId}`);
            }
          }
        }
      } catch (err) {
        console.error('[uber-webhook] processing error:', err);
      }
    }
  });

  // ── POST /pos/mgmt/uber-eats/orders/:id/accept ───────────────────────────────
  app.post('/mgmt/uber-eats/orders/:id/accept', async (req, reply) => {
    const auth = await requireWaiterOrSession(req, reply);
    if (!auth) return;

    const { id } = req.params as { id: string };
    const order = await getOrderByIdForOrg(id, auth.orgId);
    if (!order) return reply.status(404).send({ error: 'Order not found' });
    if (order.source !== 'uber-eats' || !order.externalId) {
      return reply.status(400).send({ error: 'Not an Uber Eats order' });
    }

    const tok = await uberEatsLib.getAppToken();
    await uberEatsLib.acceptOrder(tok, order.externalId);
    await transitionOrderStatus(id, auth.orgId, 'preparing');
    broadcastKitchenEvent(order.workspaceId, { type: 'order_updated', orderId: id, status: 'preparing' });
    return reply.send({ ok: true });
  });

  // ── POST /pos/mgmt/uber-eats/orders/:id/reject ───────────────────────────────
  app.post('/mgmt/uber-eats/orders/:id/reject', async (req, reply) => {
    const auth = await requireWaiterOrSession(req, reply);
    if (!auth) return;

    const { id } = req.params as { id: string };
    const order = await getOrderByIdForOrg(id, auth.orgId);
    if (!order) return reply.status(404).send({ error: 'Order not found' });
    if (order.source !== 'uber-eats' || !order.externalId) {
      return reply.status(400).send({ error: 'Not an Uber Eats order' });
    }

    const tok = await uberEatsLib.getAppToken();
    await uberEatsLib.denyOrder(tok, order.externalId);
    await transitionOrderStatus(id, auth.orgId, 'cancelled');
    broadcastKitchenEvent(order.workspaceId, { type: 'order_updated', orderId: id, status: 'cancelled' });
    return reply.send({ ok: true });
  });

  // ── Uber Eats Menu helpers ────────────────────────────────────────────────────

  /**
   * Build an Uber-format MenuConfiguration from the workspace's active POS menu.
   * Returns null if no active menu exists.
   */
  async function buildUberMenuPayload(workspaceId: string): Promise<unknown | null> {
    const menu = await db.query.posMenus.findFirst({
      where: and(
        eq(posMenus.workspaceId, workspaceId),
        eq(posMenus.isActive, true),
        isNull(posMenus.deletedAt),
      ),
    });
    if (!menu) return null;

    const categories = await db.query.posCategories.findMany({
      where: and(
        eq(posCategories.menuId, menu.id),
        eq(posCategories.isActive, true),
        isNull(posCategories.deletedAt),
      ),
      orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)],
    });

    const categoryIds = categories.map((c) => c.id);
    const items = categoryIds.length > 0
      ? await db.query.posItems.findMany({
          where: and(
            inArray(posItems.categoryId, categoryIds),
            isNull(posItems.deletedAt),
          ),
          orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)],
        })
      : [];

    const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const allDayAvailability = DAYS.map((day) => ({
      day_of_week:  day,
      time_periods: [{ start_time: '00:00', end_time: '23:59' }],
    }));

    type ModifierGroup = {
      id: string; name: string; required: boolean; maxSelect: number;
      options: Array<{ id: string; name: string; priceCents: number }>;
    };

    const uberItems: unknown[]     = [];
    const uberModGroups: unknown[] = [];
    const seenModGroups = new Set<string>();

    for (const item of items) {
      const modifiers = (item.modifiers as ModifierGroup[] | null) ?? [];

      for (const mod of modifiers) {
        if (!seenModGroups.has(mod.id)) {
          seenModGroups.add(mod.id);
          uberModGroups.push({
            id:             mod.id,
            title:          { translations: { en: mod.name } },
            quantity_info:  {
              quantity: {
                min_permitted: mod.required ? 1 : 0,
                max_permitted: mod.maxSelect,
              },
            },
            modifier_options: mod.options.map((opt) => ({ type: 'ITEM', id: opt.id })),
          });
          for (const opt of mod.options) {
            uberItems.push({
              id:         opt.id,
              title:      { translations: { en: opt.name } },
              price_info: { price: opt.priceCents },
              tax_info:   { tax_rate: 0 },
            });
          }
        }
      }

      const itemPayload: Record<string, unknown> = {
        id:         item.id,
        title:      { translations: { en: item.name } },
        price_info: { price: item.priceCents },
        tax_info:   { tax_rate: 0 },
      };
      if (item.description) itemPayload['description'] = { translations: { en: item.description } };
      if (item.imageUrl)    itemPayload['image_url']    = item.imageUrl;
      if (!item.isAvailable) {
        // suspend_until far-future = "sold out" on Uber
        itemPayload['suspension_info'] = { suspension: { suspend_until: 8640000000 } };
      }
      if (modifiers.length > 0) {
        itemPayload['modifier_group_ids'] = { ids: modifiers.map((m) => m.id) };
      }
      uberItems.push(itemPayload);
    }

    const catEntities = new Map<string, string[]>();
    for (const item of items) {
      const list = catEntities.get(item.categoryId) ?? [];
      list.push(item.id);
      catEntities.set(item.categoryId, list);
    }

    return {
      menus: [{
        id:                   menu.id,
        title:                { translations: { en: menu.name } },
        service_availability: allDayAvailability,
        category_ids:         categories.map((c) => c.id),
      }],
      categories: categories.map((cat) => ({
        id:       cat.id,
        title:    { translations: { en: cat.name } },
        entities: (catEntities.get(cat.id) ?? []).map((itemId) => ({ type: 'ITEM', id: itemId })),
      })),
      items:           uberItems,
      modifier_groups: uberModGroups,
    };
  }

  // ── POST /pos/mgmt/uber-eats/import-restaurant ─────────────────────────────
  // Pull restaurant name + address from stored Uber store data into posRestaurants.
  app.post('/mgmt/uber-eats/import-restaurant', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.body as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const restaurant = await db.query.posRestaurants.findFirst({
      where: and(eq(posRestaurants.workspaceId, workspaceId), eq(posRestaurants.orgId, user.orgId)),
      columns: { settings: true },
    });
    const uberSettings = getSettingsObject(getSettingsObject(restaurant?.settings ?? {})['uberEats']);
    const storeName    = uberSettings['storeName']    as string | undefined;
    const storeAddress = uberSettings['storeAddress'] as string | undefined;

    if (!storeName) return reply.status(400).send({ error: 'Uber Eats not connected or store data missing' });

    // Upsert the restaurant row so it always exists, then patch name + address
    await db
      .insert(posRestaurants)
      .values({
        orgId:       user.orgId,
        workspaceId,
        name:        storeName,
        address:     storeAddress ?? null,
      })
      .onConflictDoUpdate({
        target: posRestaurants.workspaceId,
        set: {
          ...(storeName    ? { name:    storeName    } : {}),
          ...(storeAddress ? { address: storeAddress } : {}),
          updatedAt: new Date(),
        },
      });

    return reply.send({ ok: true, name: storeName, address: storeAddress ?? null });
  });

  // ── POST /pos/mgmt/uber-eats/sync-menu ─────────────────────────────────────
  // Push the active POS menu to Uber Eats in full.
  app.post('/mgmt/uber-eats/sync-menu', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const restaurant = await db.query.posRestaurants.findFirst({
      where: eq(posRestaurants.workspaceId, workspaceId),
      columns: { settings: true },
    });

    const uberSettings = getSettingsObject(getSettingsObject(restaurant?.settings ?? {})['uberEats']);
    const storeId      = uberSettings['storeId'] as string | undefined;
    if (!storeId) return reply.status(400).send({ error: 'Uber Eats not connected for this workspace' });

    const menuPayload = await buildUberMenuPayload(workspaceId);
    if (!menuPayload) return reply.status(404).send({ error: 'No active menu found' });

    const appToken = await uberEatsLib.getAppToken();
    await uberEatsLib.uploadMenu(appToken, storeId, menuPayload);
    return reply.send({ ok: true });
  });

  // ── POST /pos/mgmt/uber-eats/items/:itemId/availability ────────────────────
  // Sync a single item's availability to Uber (suspend = sold out).
  app.post('/mgmt/uber-eats/items/:itemId/availability', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { itemId }    = req.params as { itemId: string };
    const { workspaceId, available } = req.body as { workspaceId?: string; available?: boolean };
    if (!workspaceId || available === undefined) {
      return reply.status(400).send({ error: 'workspaceId and available required' });
    }

    const restaurant = await db.query.posRestaurants.findFirst({
      where: eq(posRestaurants.workspaceId, workspaceId),
      columns: { settings: true },
    });

    const uberSettings = getSettingsObject(getSettingsObject(restaurant?.settings ?? {})['uberEats']);
    const storeId      = uberSettings['storeId'] as string | undefined;
    if (!storeId) return reply.status(400).send({ error: 'Uber Eats not connected for this workspace' });

    const appToken = await uberEatsLib.getAppToken();
    await uberEatsLib.updateItemAvailability(appToken, storeId, itemId, available);
    return reply.send({ ok: true });
  });
}
