/**
 * Scope-based authorization middleware.
 *
 * Enforces that agent tokens with only "forum.read" scope cannot perform
 * write operations. Fails closed on insufficient scope.
 */

import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/http-error.js';
import { auditLog } from '../lib/audit.js';

/**
 * Require specific scopes to access this endpoint.
 * Fails 403 if the required scopes are not present in req.user.scopes.
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
        throw new HttpError(403, `Required scope "${required}" not present`);
      }
    }

    next();
  };
}

/**
 * Write scope guard — blocks write operations for agent tokens
 * that only have "forum.read" scope (no "forum.write").
 *
 * This ensures agent tokens are limited to read-only access unless
 * explicitly granted write scope.
 *
 * Human tokens (auth_service_jwt, adc_jwt) are NOT restricted by this guard
 * since they have their own role-based authorization.
 */
export function requireWriteScope() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      throw new HttpError(401, '请先登录');
    }

    // Only enforce for auth_service_agent_jwt tokens
    if (user.authSource !== 'auth_service_agent_jwt') {
      return next();
    }

    const userScopes: string[] = user.scopes || [];

    // If the token has forum.write (or higher), allow
    if (userScopes.includes('forum.write')) {
      return next();
    }

    // Token only has forum.read (or other non-write scopes) — block write
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
      errorCategory: 'insufficient_scope_readonly',
    });

    throw new HttpError(403, 'Insufficient scope: write operations require forum.write scope');
  };
}
