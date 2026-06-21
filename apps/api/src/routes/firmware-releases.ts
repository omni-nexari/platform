import type { FastifyInstance } from 'fastify';
import {
  db,
  firmwareReleases,
  firmwareReleaseApprovals,
  devices,
  organizations,
} from '@signage/db';
import { eq, desc, and, isNull, isNotNull, inArray, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { sendCommand } from '../services/ws.js';

const FIRMWARE_BUILDS_ROOT = process.env['PLAYER_BUILDS_ROOT']
  ? path.join(process.env['PLAYER_BUILDS_ROOT'], 'firmware')
  : '/var/nexari/player-builds/firmware';

/** Parse Samsung firmware model + version from info.txt content.
 *  Format: "S-KSU2EWWC 1175.0"  (model SPACE version)
 *  Returns null if the format is unrecognised. */
function parseInfoTxt(content: string): { firmwareModel: string; version: string } | null {
  const trimmed = content.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace < 1) return null;
  const firmwareModel = trimmed.slice(0, lastSpace).trim();
  const version = trimmed.slice(lastSpace + 1).trim();
  if (!firmwareModel || !version) return null;
  return { firmwareModel, version };
}

/** Extract firmware model from device.firmwareVersion string.
 *  Device format: "S-KSU2EWWC-1170.6"  →  model "S-KSU2EWWC"
 *  Finds the last '-' where everything after is digits + dots. */
export function parseFirmwareModel(firmwareVersion: string): string | null {
  const match = firmwareVersion.match(/^(.+)-(\d[\d.]*)$/);
  return match ? match[1]! : null;
}

const CreateFirmwareReleaseSchema = z.object({
  firmwareModel:   z.string().min(1),
  version:         z.string().min(1),
  swVersionString: z.string().min(1),
  fileName:        z.string().min(1),
  downloadUrl:     z.string().url(),
  sizeBytes:       z.number().int().positive(),
  sha256:          z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  releaseNotes:    z.string().optional(),
});

export async function firmwareReleasesRoutes(app: FastifyInstance) {

  // ── GET /firmware-releases/latest?firmwareModel=  (any auth) ─────────────
  // Called by DeviceDetailPage to check if an update is available.
  app.get('/latest', { onRequest: [app.authenticate] }, async (req, reply) => {
    const firmwareModel = (req.query as { firmwareModel?: string })?.firmwareModel ?? '';
    if (!firmwareModel) return reply.status(400).send({ error: 'firmwareModel query param required' });

    const [release] = await db
      .select()
      .from(firmwareReleases)
      .where(and(
        eq(firmwareReleases.firmwareModel, firmwareModel),
        eq(firmwareReleases.isLatest, true),
        isNotNull(firmwareReleases.superadminApprovedAt),
      ))
      .limit(1);

    if (!release) return reply.send(null);

    return reply.send({
      ...release,
      superadminApproved: !!release.superadminApprovedAt,
    });
  });

  // ── POST /firmware-releases/upload  (deploy key) ──────────────────────────
  // Accepts a Samsung BEM ZIP (image/swuimage.bem + info.txt).
  // Extracts the .bem, parses info.txt, stores on disk.
  // Returns parsed metadata for confirmation before creating the release record.
  app.post('/upload', { onRequest: [app.authenticateDeployKey] }, async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No file provided' });

    const ext = path.extname(data.filename).toLowerCase();
    if (ext !== '.zip') {
      for await (const _ of data.file) { /* drain */ }
      return reply.status(400).send({ error: 'File must be a .zip archive' });
    }

    // Buffer the zip into memory (firmware zips are large — up to ~2 GB)
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer);
    }
    const zipBuf = Buffer.concat(chunks);

    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuf);
    } catch {
      return reply.status(400).send({ error: 'Invalid ZIP file' });
    }

    // 1. Read info.txt at zip root
    const infoEntry = zip.getEntry('info.txt');
    if (!infoEntry) return reply.status(400).send({ error: 'info.txt not found in ZIP root' });
    const infoContent = infoEntry.getData().toString('utf8');
    const parsed = parseInfoTxt(infoContent);
    if (!parsed) {
      return reply.status(400).send({
        error: `Could not parse info.txt — expected "MODEL VERSION" format, got: "${infoContent.trim()}"`,
      });
    }
    const { firmwareModel, version } = parsed;
    const swVersionString = `${firmwareModel} ${version}`;

    // 2. Find .bem file in image/ folder
    const bemEntry = zip.getEntries().find(
      (e) => e.entryName.startsWith('image/') && e.entryName.toLowerCase().endsWith('.bem') && !e.isDirectory,
    );
    if (!bemEntry) return reply.status(400).send({ error: 'No .bem file found in image/ folder' });
    const bemFileName = path.basename(bemEntry.entryName);

    // 3. Save .bem to disk
    await fs.mkdir(FIRMWARE_BUILDS_ROOT, { recursive: true });
    const destFileName = `${firmwareModel}_${version}_${bemFileName}`;
    const destPath = path.join(FIRMWARE_BUILDS_ROOT, destFileName);

    const bemData = bemEntry.getData();
    const sizeBytes = bemData.length;
    const sha256 = createHash('sha256').update(bemData).digest('hex');
    await fs.writeFile(destPath, bemData);

    const appUrl = (process.env['APP_URL'] ?? '').replace(/\/+$/, '');
    const downloadUrl = `${appUrl}/firmware/${destFileName}`;

    return reply.send({
      firmwareModel,
      version,
      swVersionString,
      fileName: bemFileName,
      downloadUrl,
      sizeBytes,
      sha256,
    });
  });

  // ── POST /firmware-releases/  (deploy key OR platform owner) ─────────────
  // Create a firmware release record from upload result.
  app.post('/', { onRequest: [app.authenticateDeployKeyOrPlatformOwner] }, async (req, reply) => {
    const body = CreateFirmwareReleaseSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    const d = body.data;

    // Deactivate previous isLatest for this firmware model
    await db
      .update(firmwareReleases)
      .set({ isLatest: false })
      .where(eq(firmwareReleases.firmwareModel, d.firmwareModel));

    const [created] = await db
      .insert(firmwareReleases)
      .values({
        firmwareModel:   d.firmwareModel,
        version:         d.version,
        swVersionString: d.swVersionString,
        fileName:        d.fileName,
        downloadUrl:     d.downloadUrl,
        sizeBytes:       d.sizeBytes,
        sha256:          d.sha256,
        releaseNotes:    d.releaseNotes,
        isLatest:        true,
      })
      .onConflictDoUpdate({
        target: [firmwareReleases.firmwareModel, firmwareReleases.version],
        set: {
          swVersionString: d.swVersionString,
          fileName:        d.fileName,
          downloadUrl:     d.downloadUrl,
          sizeBytes:       d.sizeBytes,
          sha256:          d.sha256,
          releaseNotes:    d.releaseNotes,
          isLatest:        true,
        },
      })
      .returning();

    return reply.status(201).send(created);
  });

  // ── GET /firmware-releases/  (platform owner) ─────────────────────────────
  // List all firmware releases (optional ?firmwareModel= filter).
  app.get('/', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const modelFilter = (req.query as { firmwareModel?: string })?.firmwareModel;
    const rows = modelFilter
      ? await db.select().from(firmwareReleases)
          .where(eq(firmwareReleases.firmwareModel, modelFilter))
          .orderBy(desc(firmwareReleases.publishedAt))
      : await db.select().from(firmwareReleases)
          .orderBy(desc(firmwareReleases.publishedAt));

    // Attach compatible device counts per release
    const models = [...new Set(rows.map((r) => r.firmwareModel))];
    const counts: Record<string, number> = {};
    for (const model of models) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(devices)
        .where(and(
          isNull(devices.deletedAt),
          like(devices.firmwareVersion, `${model}-%`),
        ));
      counts[model] = row?.count ?? 0;
    }

    return reply.send(rows.map((r) => ({
      ...r,
      superadminApproved: !!r.superadminApprovedAt,
      compatibleDeviceCount: counts[r.firmwareModel] ?? 0,
    })));
  });

  // ── DELETE /firmware-releases/:id  (platform owner) ───────────────────────
  app.delete('/:id', { onRequest: [app.authenticatePlatformOwner] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [deleted] = await db
      .delete(firmwareReleases)
      .where(eq(firmwareReleases.id, id))
      .returning({ id: firmwareReleases.id });
    if (!deleted) return reply.status(404).send({ error: 'Not found' });
    return reply.send({ ok: true });
  });

  // ── POST /firmware-releases/:id/approve  (deploy key OR platform owner) ───
  app.post('/:id/approve', { onRequest: [app.authenticateDeployKeyOrPlatformOwner] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [updated] = await db
      .update(firmwareReleases)
      .set({ superadminApprovedAt: new Date() })
      .where(eq(firmwareReleases.id, id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Not found' });
    return reply.send(updated);
  });

  // ── GET /firmware-releases/management-list  (management admin) ────────────
  // Returns all superadmin-approved releases with per-company approval status
  // and compatible device count within this company's client orgs.
  app.get('/management-list', { onRequest: [app.authenticateManagementCompanyAdmin] }, async (req, reply) => {
    const caller = req.user as { managementCompanyId: string };

    const rows = await db
      .select()
      .from(firmwareReleases)
      .where(isNotNull(firmwareReleases.superadminApprovedAt))
      .orderBy(desc(firmwareReleases.publishedAt));

    if (!rows.length) return reply.send([]);

    const releaseIds = rows.map((r) => r.id);
    const approvals = await db
      .select({ releaseId: firmwareReleaseApprovals.releaseId })
      .from(firmwareReleaseApprovals)
      .where(and(
        inArray(firmwareReleaseApprovals.releaseId, releaseIds),
        eq(firmwareReleaseApprovals.managementCompanyId, caller.managementCompanyId),
      ));
    const approvedSet = new Set(approvals.map((a) => a.releaseId));

    // Count compatible devices across this company's orgs
    const models = [...new Set(rows.map((r) => r.firmwareModel))];
    const counts: Record<string, number> = {};

    // Get all orgIds under this management company
    const mgmtOrgs = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.managementCompanyId, caller.managementCompanyId));
    const orgIds = mgmtOrgs.map((o) => o.id);

    if (orgIds.length > 0) {
      for (const model of models) {
        const [row] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(devices)
          .where(and(
            isNull(devices.deletedAt),
            inArray(devices.orgId, orgIds),
            like(devices.firmwareVersion, `${model}-%`),
          ));
        counts[model] = row?.count ?? 0;
      }
    }

    return reply.send(rows.map((r) => ({
      ...r,
      superadminApproved: !!r.superadminApprovedAt,
      managementApproved: approvedSet.has(r.id),
      compatibleDeviceCount: counts[r.firmwareModel] ?? 0,
    })));
  });

  // ── POST /firmware-releases/:id/management-approve  (management admin) ────
  app.post('/:id/management-approve', { onRequest: [app.authenticateManagementCompanyAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const caller = req.user as { sub: string; managementCompanyId: string };

    const release = await db.query.firmwareReleases.findFirst({ where: eq(firmwareReleases.id, id) });
    if (!release) return reply.status(404).send({ error: 'Not found' });
    if (!release.superadminApprovedAt) {
      return reply.status(422).send({ error: 'Release not yet approved by platform owner' });
    }

    await db
      .insert(firmwareReleaseApprovals)
      .values({
        releaseId:           id,
        managementCompanyId: caller.managementCompanyId,
        approvedBy:          caller.sub,
      })
      .onConflictDoNothing();

    return reply.send({ ok: true });
  });

  // ── POST /firmware-releases/:id/deploy  (management admin) ────────────────
  // Sends update_tv_firmware WS command to all compatible + online devices
  // belonging to this company's client orgs.
  app.post('/:id/deploy', { onRequest: [app.authenticateManagementCompanyAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const caller = req.user as { managementCompanyId: string };

    const release = await db.query.firmwareReleases.findFirst({ where: eq(firmwareReleases.id, id) });
    if (!release) return reply.status(404).send({ error: 'Not found' });
    if (!release.superadminApprovedAt) {
      return reply.status(422).send({ error: 'Release not yet approved by platform owner' });
    }

    // Verify management approval
    const approval = await db.query.firmwareReleaseApprovals.findFirst({
      where: and(
        eq(firmwareReleaseApprovals.releaseId, id),
        eq(firmwareReleaseApprovals.managementCompanyId, caller.managementCompanyId),
      ),
    });
    if (!approval) {
      return reply.status(422).send({ error: 'Approve this release for your clients before deploying' });
    }

    // Get all orgIds under this management company
    const mgmtOrgs = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.managementCompanyId, caller.managementCompanyId));
    const orgIds = mgmtOrgs.map((o) => o.id);
    if (!orgIds.length) return reply.send({ sent: 0, skipped: 0 });

    // Find compatible online Tizen devices
    const compatibleDevices = await db
      .select({ id: devices.id, firmwareVersion: devices.firmwareVersion })
      .from(devices)
      .where(and(
        isNull(devices.deletedAt),
        inArray(devices.orgId, orgIds),
        eq(devices.status, 'online'),
        like(devices.firmwareVersion, `${release.firmwareModel}-%`),
      ));

    const command = {
      command: 'update_tv_firmware',
      payload: {
        softwareId: '0',
        fileName:   release.fileName,
        swVersion:  release.swVersionString,
        url:        release.downloadUrl,
        sizeBytes:  release.sizeBytes,
      },
    };

    let sent = 0;
    let skipped = 0;
    for (const device of compatibleDevices) {
      const delivered = sendCommand(device.id, { type: 'update_tv_firmware', payload: command.payload });
      if (delivered) sent++;
      else skipped++;
    }

    return reply.send({ sent, skipped, total: compatibleDevices.length });
  });
}
