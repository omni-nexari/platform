import { db, managementCompanies, organizations, tenantRoutes, workspaces } from '@signage/db';
import { RESERVED_TENANT_PATH_PREFIXES } from '@signage/shared';
import { and, eq, isNull } from 'drizzle-orm';

export function normalizeTenantHostname(hostHeader: string | null | undefined) {
  const firstHost = (hostHeader ?? '').split(',')[0]?.trim() ?? '';
  return firstHost
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

export function normalizeTenantPathPrefix(pathname: string | null | undefined) {
  const trimmed = (pathname ?? '').trim();
  if (!trimmed) return '';
  const withoutQuery = trimmed.split('?')[0] ?? '';
  return withoutQuery.replace(/^\/+/, '').split('/')[0]?.toLowerCase() ?? '';
}

function isReservedPathPrefix(prefix: string) {
  return RESERVED_TENANT_PATH_PREFIXES.includes(prefix as typeof RESERVED_TENANT_PATH_PREFIXES[number]);
}

async function findActiveRoute(hostname: string, pathPrefix: string) {
  const route = await db.query.tenantRoutes.findFirst({
    where: and(
      eq(tenantRoutes.hostname, hostname),
      eq(tenantRoutes.pathPrefix, pathPrefix),
      isNull(tenantRoutes.deletedAt),
    ),
  });
  if (!route) return null;

  const [managementCompany, organization, workspace] = await Promise.all([
    db.query.managementCompanies.findFirst({
      where: and(eq(managementCompanies.id, route.managementCompanyId), isNull(managementCompanies.deletedAt)),
    }),
    route.organizationId
      ? db.query.organizations.findFirst({
        where: and(eq(organizations.id, route.organizationId), isNull(organizations.deletedAt)),
      })
      : Promise.resolve(null),
    route.workspaceId
      ? db.query.workspaces.findFirst({
        where: and(eq(workspaces.id, route.workspaceId), isNull(workspaces.deletedAt)),
      })
      : Promise.resolve(null),
  ]);

  return { route, managementCompany: managementCompany ?? null, organization: organization ?? null, workspace: workspace ?? null };
}

export async function resolveTenantRoute(hostHeader: string | null | undefined, pathname?: string | null) {
  const hostname = normalizeTenantHostname(hostHeader);
  if (!hostname) return null;

  const pathPrefix = normalizeTenantPathPrefix(pathname);
  if (pathPrefix && !isReservedPathPrefix(pathPrefix)) {
    const pathRoute = await findActiveRoute(hostname, pathPrefix);
    if (pathRoute) return { ...pathRoute, source: 'path' as const };
  }

  const hostRoute = await findActiveRoute(hostname, '');
  if (hostRoute) return { ...hostRoute, source: 'host' as const };

  return null;
}
