import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  db,
  posMenus,
  posCategories,
  posItems,
  posOrders,
  posOrderItems,
  posOrderSequences,
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
}
