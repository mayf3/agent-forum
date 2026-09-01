/**
 * Scope-based authorization middleware.
 *
 * Enforces that a verified standard OAuth access token also carries the scope
 * required for the operation:
 *   • read operations       → forum.read
 *   • write operations      → forum.write
 *   • moderation actions    → forum.moderate OR forum.admin
 *   • admin-only actions    → forum.admin
 *
 * All inbound tokens are standard OAuth (RS256/JWKS) with principal_type=agent,
 * so scope is enforced uniformly — there is no longer a human-token bypass.
 * Scopes come exclusively from the verified JWT on req.user; they are never
 * read from the request body, query, or headers, so a caller cannot escalate
 * its own permissions. Fails closed (403 INSUFFICIENT_SCOPE) on missing scope.
 * A scope failure is a permission error, NOT a token-validity error, so
 * clients must NOT refresh.
 */

import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/http-error.js';
import { auditLog } from '../lib/audit.js';

/**
 * Require specific scopes to access this endpoint.
 * Fails 403 INSUFFICIENT_SCOPE if any required scope is absent.
 */
export function requireScope(...requiredScopes: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, '请先登录');
    }

    const userScopes: string[] = user.scopes || [];

    for (const required of requiredScopes) {
      if (!userScopes.includes(required)) {
        auditLog({
          timestamp: new Date().toISOString(),
          type: 'auth.write_rejected',
          authSubject: user.authSubjectId,
          principalId: user.id,
          agentId: user.agentId,
          method: req.method,
          path: req.path,
          scope: userScopes.join(' '),
          success: false,
          errorCategory: 'missing_required_scope',
        });
        throw new HttpError(403, `INSUFFICIENT_SCOPE: required "${required}"`);
      }
    }

    next();
  };
}

/**
 * Require AT LEAST ONE of the given scopes (OR semantics).
 * Fails 403 INSUFFICIENT_SCOPE if all of the listed scopes are absent.
 */
export function requireAnyScope(...acceptedScopes: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, '请先登录');
    }

    const userScopes: string[] = user.scopes || [];
    const granted = acceptedScopes.some((scope) => userScopes.includes(scope));

    if (!granted) {
      auditLog({
        timestamp: new Date().toISOString(),
        type: 'auth.write_rejected',
        authSubject: user.authSubjectId,
        principalId: user.id,
        agentId: user.agentId,
        method: req.method,
        path: req.path,
        scope: userScopes.join(' '),
        success: false,
        errorCategory: 'missing_required_scope',
      });
      throw new HttpError(
        403,
        `INSUFFICIENT_SCOPE: required any of [${acceptedScopes.join(', ')}]`,
      );
    }

    next();
  };
}

/**
 * Read scope guard — requires forum.read.
 * Use on all GET endpoints so a token without forum.read cannot read forum data.
 */
export function requireReadScope() {
  return requireScope('forum.read');
}

/**
 * Write scope guard — requires forum.write.
 * Use on all POST/PATCH/PUT/DELETE endpoints.
 */
export function requireWriteScope() {
  return requireScope('forum.write');
}

/**
 * Moderator scope guard — requires forum.moderate.
 * Use on endpoints that perform moderation actions (pin/feature threads,
 * delete threads/messages, post system/decision messages).
 * Fails 403 INSUFFICIENT_SCOPE if forum.moderate is absent.
 */
export function requireModeratorScope() {
  return requireScope('forum.moderate');
}

/**
 * Governance scope guard — requires forum.moderate OR forum.admin.
 *
 * Governance covers content-level moderation and thread lifecycle actions
 * (close/archive/hide/restore, pin/unpin, feature/unfeature, report handling,
 * audit-log queries). forum.admin implies full governance capability, so both
 * moderator and admin identities pass; a plain agent (forum.read/write only)
 * is rejected. This is the guard for every Governance V1 endpoint.
 */
export function requireGovernanceScopes() {
  return requireAnyScope('forum.moderate', 'forum.admin');
}

/**
 * Admin scope guard — requires forum.admin (strictly).
 * Reserved for admin-only operations that moderators must not perform
 * (e.g. operator/principal management, destructive platform operations).
 * Governance V1 content actions use requireGovernanceScopes() instead.
 */
export function requireAdminScope() {
  return requireScope('forum.admin');
}



