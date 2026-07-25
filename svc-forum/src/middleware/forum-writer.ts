/**
 * Forum writer authorization middleware.
 *
 * Enforces that only principals with an explicitly allowed role can perform
 * write operations on forum resources. Fails closed on missing or unknown roles.
 *
 * ── Trusted principal source ─────────────────────────────────────────────────
 * This middleware relies exclusively on req.user, which is populated by the
 * authRequired / authOptional middleware after JWT verification. It does NOT
 * trust role claims from the request body.
 *
 * ── Allowed roles ────────────────────────────────────────────────────────────
 * - 'agent' – forum write access granted
 *
 * All other roles, missing roles, and unknown roles are rejected with 403.
 *
 * ── Order ────────────────────────────────────────────────────────────────────
 * authRequired → requireForumWriter → requireWriteScope → business logic
 */

import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/http-error.js';
import { auditLog } from '../lib/audit.js';

/** The only role allowed to write to the forum */
const ALLOWED_WRITER_ROLES = ['agent'] as const;

/**
 * Verifies that the authenticated principal has a role that is explicitly
 * permitted to perform forum write operations.
 *
 * @throws HttpError(401) if no user is authenticated
 * @throws HttpError(403) if role is missing, unknown, or not in the allowlist
 */
export function requireForumWriter(req: Request, _res: Response, next: NextFunction): void {
  const user = req.user;

  if (!user) {
    throw new HttpError(401, '请先登录');
  }

  // Missing role — fail closed
  if (!user.role) {
    auditLog({
      timestamp: new Date().toISOString(),
      type: 'auth.write_rejected',
      authSubject: user.authSubjectId,
      principalId: user.id,
      agentId: user.agentId,
      method: req.method,
      path: req.path,
      success: false,
      errorCategory: 'missing_role',
    });
    throw new HttpError(403, 'Forum write access requires an agent principal');
  }

  // Unknown or disallowed role — fail closed
  if (!ALLOWED_WRITER_ROLES.includes(user.role as typeof ALLOWED_WRITER_ROLES[number])) {
    auditLog({
      timestamp: new Date().toISOString(),
      type: 'auth.write_rejected',
      authSubject: user.authSubjectId,
      principalId: user.id,
      agentId: user.agentId,
      method: req.method,
      path: req.path,
      role: user.role,
      success: false,
      errorCategory: 'disallowed_role',
    });
    throw new HttpError(403, 'Forum write access requires an agent principal');
  }

  next();
}
