import type { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Signage Platform API',
        description: 'REST API for the Nexari Signage CMS platform',
        version: '1.0.0',
      },
      servers: [{ url: '/api/v1', description: 'Current server' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          cookieAuth: { type: 'apiKey', in: 'cookie', name: 'access_token' },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'Auth', description: 'Authentication and session management' },
        { name: 'Content', description: 'Content library management' },
        { name: 'Playlists', description: 'Playlist management' },
        { name: 'Schedules', description: 'Schedule management' },
        { name: 'Devices', description: 'Device management and remote control' },
        { name: 'Analytics', description: 'Proof-of-play and reporting' },
        { name: 'Workspaces', description: 'Workspace management' },
        { name: 'Tags', description: 'Tag management' },
        { name: 'Notifications', description: 'In-app notifications' },
        { name: 'Sync', description: 'SyncPlay group management' },
        { name: 'Emergency', description: 'Emergency overrides' },
      ],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'none',
      deepLinking: true,
      persistAuthorization: true,
    },
    staticCSP: true,
  });
}
