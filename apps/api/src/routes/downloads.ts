/**
 * downloads.ts — public installer download endpoints.
 *
 * Provides unauthenticated routes used by the marketing landing page
 * and by `electron-updater` running
 * on the desktop player to fetch the signed `latest.yml` manifest.
 *
 *   GET /downloads/:platform           302 → latest installer
 *   GET /downloads/:platform/latest.yml 302 → electron-updater manifest
 *   GET /downloads/:platform/info       latest release metadata (json)
 */
import type { FastifyInstance } from 'fastify';
import { db, playerReleases } from '@signage/db';
import { and, eq } from 'drizzle-orm';

const PUBLIC_PLATFORMS = ['windows', 'tizen', 'android', 'epaper'] as const;
type PublicPlatform = typeof PUBLIC_PLATFORMS[number];

function isPublicPlatform(value: string): value is PublicPlatform {
  return (PUBLIC_PLATFORMS as readonly string[]).includes(value);
}

export async function downloadsRoutes(app: FastifyInstance) {
  app.get('/:platform/info', async (req, reply) => {
    const { platform } = req.params as { platform: string };
    if (!isPublicPlatform(platform)) {
      return reply.status(404).send({ error: 'Unknown platform' });
    }

    const [release] = await db
      .select()
      .from(playerReleases)
      .where(and(eq(playerReleases.platform, platform), eq(playerReleases.isLatest, true)))
      .limit(1);

    if (!release) return reply.status(404).send({ error: 'No published release for this platform yet' });

    return reply.send({
      platform: release.platform,
      version: release.version,
      releaseNotes: release.releaseNotes,
      downloadUrl: release.downloadUrl,
      manifestUrl: release.manifestUrl,
      sha512: release.sha512,
      sizeBytes: release.sizeBytes,
      publishedAt: release.publishedAt,
    });
  });

  // GET /downloads/windows → 302 to the .exe
  app.get('/:platform', async (req, reply) => {
    const { platform } = req.params as { platform: string };
    if (!isPublicPlatform(platform)) {
      return reply.status(404).send({ error: 'Unknown platform' });
    }

    const [release] = await db
      .select()
      .from(playerReleases)
      .where(and(eq(playerReleases.platform, platform), eq(playerReleases.isLatest, true)))
      .limit(1);

    if (!release) return reply.status(404).send({ error: 'No published release for this platform yet' });

    return reply.redirect(release.downloadUrl, 302);
  });

  // GET /downloads/windows/latest.yml → electron-updater manifest
  app.get('/:platform/latest.yml', async (req, reply) => {
    const { platform } = req.params as { platform: string };
    if (!isPublicPlatform(platform)) {
      return reply.status(404).send({ error: 'Unknown platform' });
    }

    const [release] = await db
      .select()
      .from(playerReleases)
      .where(and(eq(playerReleases.platform, platform), eq(playerReleases.isLatest, true)))
      .limit(1);

    if (!release) return reply.status(404).send({ error: 'No published release for this platform yet' });

    if (release.manifestUrl) {
      return reply.redirect(release.manifestUrl, 302);
    }

    // Fall back to a synthesised manifest if none was uploaded but we have sha512.
    if (release.sha512 && release.sizeBytes) {
      const fileName = release.downloadUrl.split('/').pop() ?? `nexari-${platform}-${release.version}.exe`;
      const yml = [
        `version: ${release.version}`,
        `files:`,
        `  - url: ${release.downloadUrl}`,
        `    sha512: ${release.sha512}`,
        `    size: ${release.sizeBytes}`,
        `path: ${fileName}`,
        `sha512: ${release.sha512}`,
        `releaseDate: '${new Date(release.publishedAt).toISOString()}'`,
      ].join('\n');
      reply.header('content-type', 'application/x-yaml');
      return reply.send(yml);
    }

    return reply.status(404).send({ error: 'Manifest not available for this release' });
  });
}
