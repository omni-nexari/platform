import type { FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void>;
    /** Platform owner only (was super_admin) */
    authenticatePlatformOwner(req: FastifyRequest, reply: FastifyReply): Promise<void>;
    /** Management company admin only */
    authenticateManagementCompanyAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void>;
    /** Accepts platform_owner OR management_company_admin */
    authenticatePlatformAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void>;
    /** @deprecated — alias for authenticatePlatformOwner */
    authenticateSuperAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}
