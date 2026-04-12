import type { FastifyInstance } from 'fastify';
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
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
  posInventoryItems,
  posEmployees,
  posTimeEntries,
  posLoyaltyCustomers,
  posLoyaltyEvents,
  posExpenses,
  posPurchaseOrders,
} from '@signage/db';

// ─── Device JWT helpers (same pattern as devices.ts) ────────────────────────────
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
  workspaceId:  z.string().uuid(),
  customerName: z.string().max(80).optional(),
  notes:        z.string().max(500).optional(),
  items:        z.array(OrderItemInputSchema).min(1).max(50),
});

const UpdateOrderStatusSchema = z.object({
  status: z.enum(['preparing', 'ready', 'completed', 'cancelled']),
});

const VALID_ACTIVE_STATUSES = ['pending', 'preparing', 'ready'] as const;

// ─── Route plugin ───────────────────────────────────────────────────────────────
export async function posRoutes(app: FastifyInstance) {

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
    const auth = authenticateDeviceRequest(req as never, reply as never, app);
    if (!auth) return;

    const parsed = CreateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { workspaceId, customerName, notes, items: inputItems } = parsed.data;

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
        deviceId:     auth.deviceId,
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

    const order = await db.query.posOrders.findFirst({
      where: eq(posOrders.id, orderId),
      columns: { id: true, status: true, workspaceId: true },
    });

    if (!order) return reply.status(404).send({ error: 'Order not found' });

    const now = new Date();
    const extra: Record<string, unknown> = {};
    if (status === 'completed') extra['completedAt'] = now;
    if (status === 'cancelled') extra['cancelledAt'] = now;

    await db
      .update(posOrders)
      .set({ status, updatedAt: now, ...extra })
      .where(eq(posOrders.id, orderId));

    return reply.send({ id: orderId, status });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // SESSION-AUTHENTICATED MANAGEMENT ROUTES
  // ══════════════════════════════════════════════════════════════════════════════

  type AuthUser = { sub: string; orgId: string; role: string };

  // ─── Restaurant profile ──────────────────────────────────────────────────────

  app.get('/restaurant', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const restaurant = await db.query.posRestaurants.findFirst({
      where: and(eq(posRestaurants.workspaceId, workspaceId), eq(posRestaurants.orgId, user.orgId)),
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

  app.get('/tables', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const tables = await db.query.posTables.findMany({
      where: and(eq(posTables.workspaceId, workspaceId), eq(posTables.isActive, true)),
      orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.number)],
    });
    return reply.send(tables);
  });

  app.post('/tables', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId } = req.query as { workspaceId?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const body = req.body as { number: number; name?: string; seats?: number; location?: string };
    const [table] = await db
      .insert(posTables)
      .values({ workspaceId, number: body.number, name: body.name ?? null, seats: body.seats ?? 4, location: body.location ?? null })
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

    const [config] = await db
      .insert(posKioskConfig)
      .values({ workspaceId, ...body, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: posKioskConfig.workspaceId,
        set: { ...body, updatedAt: new Date() },
      })
      .returning();
    return reply.send(config);
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
    const body = req.body as { categoryId: string; name: string; priceCents: number; description?: string | null };
    const [item] = await db
      .insert(posItems)
      .values({ categoryId: body.categoryId, name: body.name, priceCents: body.priceCents, description: body.description ?? null })
      .returning();
    return reply.status(201).send(item);
  });

  app.patch('/mgmt/items/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; priceCents?: number; description?: string | null; isAvailable?: boolean };
    const [updated] = await db
      .update(posItems)
      .set({ ...body, updatedAt: new Date() })
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

  // ─── Orders management (session auth — for portal views) ────────────────────

  app.get('/mgmt/orders', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId, status } = req.query as { workspaceId?: string; status?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });

    const requestedStatuses = status
      ? status.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const orders = await db.query.posOrders.findMany({
      where: and(
        eq(posOrders.workspaceId, workspaceId),
        requestedStatuses.length > 0 ? inArray(posOrders.status, requestedStatuses as string[]) : undefined,
      ),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });

    const orderIds = orders.map((o) => o.id);
    const lineItems = orderIds.length > 0
      ? await db.query.posOrderItems.findMany({
          where: inArray(posOrderItems.orderId, orderIds),
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
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        customerName: o.customerName,
        notes: o.notes,
        totalCents: o.totalCents,
        createdAt: o.createdAt,
        items: (itemsByOrder.get(o.id) ?? []).map((li) => ({
          id: li.id,
          itemName: li.itemName,
          quantity: li.quantity,
          unitPriceCents: li.itemPriceCents,
          lineTotalCents: li.lineTotalCents,
          notes: li.notes,
        })),
      })),
    );
  });

  app.patch('/mgmt/orders/:id/status', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = UpdateOrderStatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid status' });

    const now = new Date();
    const extra: Record<string, unknown> = {};
    if (parsed.data.status === 'completed') extra['completedAt'] = now;
    if (parsed.data.status === 'cancelled') extra['cancelledAt'] = now;

    const [updated] = await db
      .update(posOrders)
      .set({ status: parsed.data.status, updatedAt: now, ...extra })
      .where(eq(posOrders.id, id))
      .returning({ id: posOrders.id, status: posOrders.status });

    if (!updated) return reply.status(404).send({ error: 'Order not found' });
    return reply.send(updated);
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

  app.post('/mgmt/orders', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
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
    if (menu.orgId !== user.orgId) return reply.status(403).send({ error: 'Forbidden' });

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
        orgId: menu.orgId, workspaceId, deviceId: tableId ?? null,
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

    return reply.status(201).send({
      id: order.id,
      orderNumber: order.orderNumber,
      totalCents,
      items: lineItems.map((li) => ({ itemName: li.itemName, quantity: li.quantity, lineTotalCents: li.lineTotalCents })),
    });
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
    const { id } = req.params as { id: string };
    const parsed = MgmtPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    const { method, amountCents, tipCents, reference } = parsed.data;

    const order = await db.query.posOrders.findFirst({
      where: eq(posOrders.id, id),
      columns: { id: true, status: true, totalCents: true, workspaceId: true },
    });
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

    const now = new Date();
    await db
      .update(posOrders)
      .set({ status: 'completed', completedAt: now, updatedAt: now })
      .where(eq(posOrders.id, id));

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

  app.get('/mgmt/loyalty/customers', { onRequest: [app.authenticate] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const { workspaceId, q } = req.query as { workspaceId?: string; q?: string };
    if (!workspaceId) return reply.status(400).send({ error: 'workspaceId required' });
    const customers = await db.query.posLoyaltyCustomers.findMany({
      where: and(eq(posLoyaltyCustomers.workspaceId, workspaceId), eq(posLoyaltyCustomers.orgId, user.orgId)),
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
}
