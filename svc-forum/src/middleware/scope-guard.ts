/**
 * Scope-based authorization middleware.
 *
 * Enforces that a verified standard OAuth access token also carries the scope
 * required for the operation:
 *   • read operations  → forum.read
 *   • write operations → forum.write
 *
 * All inbound tokens are standard OAuth (RS256/JWKS) with principal_type=agent,
 * so scope is enforced uniformly — there is no longer a human-token bypass.
 * Fails closed (403 INSUFFICIENT_SCOPE) on missing scope. A scope failure is a
 * permission error, NOT a token-validity error, so clients must NOT refresh.
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


