import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './auth.js';
import { managementCompanies } from './management.js';
import { workspaces } from './workspaces.js';

// ---------------------------------------------------------------------------
// Tenant routes
// ---------------------------------------------------------------------------
// Maps partner-managed host/path routes to management companies, client orgs,
// and optionally default workspaces:
//   partner.com/management  -> management portal (implicit app route)
//   client1.partner.com     -> client org route
//   partner.com/client1     -> client org path alias
// pathPrefix is an empty string for host-only routes.
export const tenantRoutes = pgTable(
  'tenant_routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostname: text('hostname').notNull(),
    pathPrefix: text('path_prefix').notNull().default(''),
    routeType: text('route_type').notNull().default('client_org'), // management | client_org | workspace
    managementCompanyId: uuid('management_company_id')
      .notNull()
      .references(() => managementCompanies.id),
    organizationId: uuid('organization_id').references(() => organizations.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    status: text('status').notNull().default('pending_dns'), // pending_dns | verified | active | failed
    verificationToken: text('verification_token').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    tlsStatus: text('tls_status').notNull().default('pending'), // pending | ready | failed | external
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_tenant_routes_hostname_path_active').on(t.hostname, t.pathPrefix).where(sql`${t.deletedAt} IS NULL`),
    index('idx_tenant_routes_company').on(t.managementCompanyId),
    index('idx_tenant_routes_org').on(t.organizationId),
    index('idx_tenant_routes_workspace').on(t.workspaceId),
  ],
);
