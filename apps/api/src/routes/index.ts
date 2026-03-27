import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.js';
import { healthRoute } from './health.js';
import { superAdminRoutes } from './superadmin.js';
import { workspaceRoutes } from './workspaces.js';
import { deviceRoutes } from './devices.js';
import { emergencyRoutes } from './emergency.js';
import { contentRoutes } from './content.js';
import { playlistRoutes } from './playlists.js';
import { scheduleRoutes } from './schedules.js';
import { tagRoutes } from './tags.js';
import { orgRoutes } from './org.js';
import { auditRoutes } from './audit.js';
import { apiKeysRoutes } from './api-keys.js';
import { notificationsRoutes } from './notifications.js';
import { searchRoutes } from './search.js';
import { canvasRoutes } from './canvas.js';
import { smartViewsRoutes } from './smart-views.js';
import { analyticsRoutes } from './analytics.js';
import { syncPlaylistRoutes } from './sync-playlists.js';
import { syncGroupRoutes } from './sync-groups.js';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(healthRoute);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(superAdminRoutes, { prefix: '/superadmin' });
  await app.register(workspaceRoutes, { prefix: '/workspaces' });
  await app.register(deviceRoutes, { prefix: '/devices' });
  await app.register(emergencyRoutes, { prefix: '/emergency' });
  await app.register(contentRoutes, { prefix: '/content' });
  await app.register(playlistRoutes, { prefix: '/playlists' });
  await app.register(scheduleRoutes, { prefix: '/schedules' });
  await app.register(tagRoutes, { prefix: '/tags' });
  await app.register(orgRoutes, { prefix: '/org' });
  await app.register(auditRoutes, { prefix: '/audit' });
  await app.register(apiKeysRoutes, { prefix: '/api-keys' });
  await app.register(notificationsRoutes, { prefix: '/notifications' });
  await app.register(searchRoutes, { prefix: '/search' });
  await app.register(canvasRoutes, { prefix: '/canvas' });
  await app.register(smartViewsRoutes, { prefix: '/smart-views' });
  await app.register(analyticsRoutes, { prefix: '/analytics' });
  await app.register(syncPlaylistRoutes, { prefix: '/sync-playlists' });
  await app.register(syncGroupRoutes, { prefix: '/sync-groups' });
}

