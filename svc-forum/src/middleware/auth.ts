/**
 * Authentication middleware for svc-forum.
 *
 * Supports four token types, verified in priority order:
 *   Priority 1 (NEW): auth-service Agent JWT — aud=svc-forum, principal_type=agent
 *   Priority 2 (existing): auth-service Human JWT — aud=agent-platform
 *   Priority 3 (existing): ADC JWT — aud=adc-api, iss=agent-dev-center
 *   Priority 4 (existing): ADC backward compat — bare verify
 *
 * Agent JWT tokens trigger JIT Shadow Principal creation via resolvePrincipal().
 * All tokens set authSource in req.user for source tracking.
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { normalizePrincipal } from '../identity/principal.js';
import { resolvePrincipal, findPrincipal, isValidAgentId } from '../lib/forum-principal.js';
import { auditLog } from '../lib/audit.js';
import type { PrincipalType, IdentityMode, AuthSource } from '../identity/principal.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type { AuthSource };

interface AgentJwtClaims {
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti?: string;
  type?: string;
  version?: string;
  principal_type: string;
  agent_id: string;
  client_id: string;
  scope: string;
}

interface HumanJwtClaims {
  sub?: string;
  name?: string;
  role?: string;
  agentId?: string;
  permissions?: string[];
  iss?: string;
  aud?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        role?: string;
        source?: string;
        permissions?: string[];
        authSubjectId: string;
        agentId?: string;
        principalType: PrincipalType;
        issuer: string;
        identityMode: IdentityMode;
        /** PR-3A: source of authentication */
        authSource: AuthSource;
        /** PR-3A: scopes from agent JWT */
        scopes: string[];
      };
    }
  }
}

// ── Constants ──────────────────────────────────────────────────────────────

const ADC_JWT_ISSUER = 'agent-dev-center';
const ADC_JWT_AUDIENCE = 'adc-api';
const MAX_TOKEN_SIZE = 16384; // 16KB max token size

/** Strict UUID v4 pattern */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse scope string into sorted unique array.
 */
function parseScope(scope: string): string[] {
  if (!scope || !scope.trim()) return [];
  return [...new Set(scope.trim().split(/\s+/))].sort();
}

/**
 * Check if a value is a valid UUID.
 */
function isUuid(val: unknown): boolean {
  return typeof val === 'string' && UUID_PATTERN.test(val);
}

/**
 * Extract Bearer token from Authorization header.
 */
function extractToken(req: Request): string | null {
  const auth = req.header('authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

// ── Agent JWT verification ─────────────────────────────────────────────────

interface AgentVerificationResult {
  tokenType: 'agent';
  claims: AgentJwtClaims;
  authSource: AuthSource;
}

/**
 * Verify an auth-service Agent JWT.
 * Checks: signature, issuer, audience, expiry, principal_type, sub, agent_id, scope.
 */
function verifyAgentJwt(token: string): AgentVerificationResult | null {
  // Size check
  if (token.length > MAX_TOKEN_SIZE) {
    auditLog({ timestamp: new Date().toISOString(), type: 'jwt.failed', success: false, errorCategory: 'oversized' });
    return null;
  }

  // Algorithm check: reject alg=none
  try {
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    if (!header.alg || header.alg === 'none') {
      auditLog({ timestamp: new Date().toISOString(), type: 'jwt.failed', success: false, errorCategory: 'alg_none' });
      return null;
    }
  } catch {
    auditLog({ timestamp: new Date().toISOString(), type: 'jwt.failed', success: false, errorCategory: 'malformed' });
    return null;
  }

  // Full verification
  try {
    const payload = jwt.verify(token, env.AUTH_JWT_SECRET, {
      issuer: env.AUTH_JWT_ISSUER,
      audience: env.AUTH_JWT_SVC_FORUM_AUDIENCE,
      clockTolerance: env.AUTH_JWT_MAX_CLOCK_SKEW,
    }) as jwt.JwtPayload;

    const claims = payload as unknown as AgentJwtClaims;

    // Check principal_type
    if (claims.principal_type !== 'agent') {
      auditLog({ timestamp: new Date().toISOString(), type: 'jwt.failed', authSubject: claims.sub, success: false, errorCategory: 'wrong_principal_type' });
      return null;
    }

    // Check sub is valid UUID
    if (!isUuid(claims.sub)) {
      auditLog({ timestamp: new Date().toISOString(), type: 'jwt.failed', authSubject: claims.sub, success: false, errorCategory: 'invalid_sub' });
      return null;
    }

    // Check agent_id is present and valid format
    if (!claims.agent_id || !isValidAgentId(claims.agent_id)) {
      auditLog({ timestamp: new Date().toISOString(), type: 'jwt.failed', authSubject: claims.sub, success: false, errorCategory: 'missing_agent_id' });
      return null;
    }

    // Check client_id is present
    if (!claims.client_id) {
      auditLog({ timestamp: new Date().toISOString(), type: 'jwt.failed', authSubject: claims.sub, success: false, errorCategory: 'missing_client_id' });
      return null;
    }

    // Check scope contains forum.read
    if (!claims.scope || !claims.scope.includes('forum.read')) {
      auditLog({ timestamp: new Date().toISOString(), type: 'jwt.failed', authSubject: claims.sub, success: false, errorCategory: 'missing_scope' });
      return null;
    }

    return { tokenType: 'agent', claims, authSource: 'auth_service_agent_jwt' };
  } catch (err: any) {
    if (err instanceof jwt.TokenExpiredError) {
      auditLog({ timestamp: new Date().toISOString(), type: 'jwt.failed', success: false, errorCategory: 'expired' });
    } else if (err instanceof jwt.JsonWebTokenError) {
      if (err.message.includes('issuer')) {
        auditLog({ timestamp: new Date().toISOString(), type: 'jwt.failed', success: false, errorCategory: 'wrong_issuer' });
      } else if (err.message.includes('audience')) {
        auditLog({ timestamp: new Date().toISOString(), type: 'jwt.failed', success: false, errorCategory: 'wrong_audience' });
      } else {
        auditLog({ timestamp: new Date().toISOString(), type: 'jwt.failed', success: false, errorCategory: 'bad_signature' });
      }
    }
    return null;
  }
}

// ── Human JWT verification (existing) ──────────────────────────────────────

interface HumanVerificationResult {
  tokenType: 'human';
  payload: HumanJwtClaims;
  authSource: AuthSource;
}

/**
 * Try all three legacy verification paths and return the first that succeeds.
 */
function verifyHumanJwt(token: string): HumanVerificationResult | null {
  // Priority 2: auth-service human JWT
  if (env.AUTH_JWT_SECRET) {
    try {
      const payload = jwt.verify(token, env.AUTH_JWT_SECRET, {
        issuer: env.AUTH_JWT_ISSUER,
        audience: env.AUTH_JWT_AUDIENCE,
        clockTolerance: env.AUTH_JWT_MAX_CLOCK_SKEW,
      }) as HumanJwtClaims;
      return { tokenType: 'human', payload, authSource: 'auth_service_jwt' };
    } catch {
      // fall through
    }
  }

  // Priority 3: ADC JWT
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: ADC_JWT_ISSUER,
      audience: ADC_JWT_AUDIENCE,
    }) as HumanJwtClaims;
    return { tokenType: 'human', payload, authSource: 'adc_jwt' };
  } catch {
    // fall through
  }

  // Priority 4: ADC JWT without issuer/audience (backward compat)
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as HumanJwtClaims;
    return { tokenType: 'human', payload, authSource: 'adc_legacy' };
  } catch (err: any) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new HttpError(401, 'TOKEN_EXPIRED');
    }
    throw new HttpError(401, 'Token 无效');
  }
}

// ── Build req.user ─────────────────────────────────────────────────────────

/**
 * Build req.user from agent JWT claims and resolved ForumPrincipal.
 */
function buildAgentUser(
  claims: AgentJwtClaims,
  principal: { id: string; authSubject: string; agentId: string | null; displayName: string | null; status: string },
  authSource: AuthSource,
) {
  return {
    id: principal.id,
    name: claims.agent_id || principal.displayName || principal.id,
    role: 'agent',
    source: authSource,
    permissions: [],
    authSubjectId: claims.sub,
    agentId: claims.agent_id,
    principalType: 'agent' as PrincipalType,
    issuer: claims.iss,
    identityMode: 'legacy-sub' as IdentityMode,
    authSource,
    scopes: parseScope(claims.scope),
  };
}

/**
 * Build req.user from human JWT payload using canonical principal normalization.
 */
function buildHumanUser(payload: HumanJwtClaims, authSource: AuthSource) {
  const principal = normalizePrincipal(payload, env.FORUM_IDENTITY_MODE);

  return {
    id: principal.principalId,
    name: payload.name || principal.principalId || '',
    role: payload.role,
    source: authSource,
    permissions: payload.permissions || [],
    authSubjectId: principal.authSubjectId,
    agentId: principal.businessAgentId,
    principalType: principal.principalType,
    issuer: principal.issuer,
    identityMode: principal.identityMode,
    authSource,
    scopes: [],
  };
}

// ── Middleware: authRequired ────────────────────────────────────────────────

/**
 * Required authentication middleware.
 * Verifies token and populates req.user. Throws 401 on failure.
 */
export const authRequired = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);

  if (!token) {
    throw new HttpError(401, '请先登录');
  }

  // Priority 1: auth-service Agent JWT
  const agentResult = verifyAgentJwt(token);
  if (agentResult) {
    const { claims, authSource } = agentResult;

    // JIT: resolve/create ForumPrincipal
    try {
      const principal = await resolvePrincipal({
        authSubject: claims.sub,
        agentId: claims.agent_id,
        displayName: claims.agent_id,
        principalType: 'agent',
      });

      req.user = buildAgentUser(claims, principal, authSource);

      auditLog({
        timestamp: new Date().toISOString(),
        type: 'jwt.verified',
        authSubject: claims.sub,
        agentId: claims.agent_id,
        principalType: 'agent',
        authSource,
        issuer: claims.iss,
        audience: claims.aud,
        scope: claims.scope,
        success: true,
      });

      return next();
    } catch (err: any) {
      if (err instanceof HttpError) {
        // Map 409 identity conflicts to 401 for the caller
        if (err.statusCode === 409) {
          throw new HttpError(401, `Identity conflict: ${err.message}`);
        }
        throw err;
      }
      throw new HttpError(500, 'Failed to resolve agent identity');
    }
  }

  // Priority 2-4: Human JWT (auth-service, ADC, backward compat)
  try {
    const humanResult = verifyHumanJwt(token);
    if (!humanResult) {
      throw new HttpError(401, 'Token 无效');
    }

    const { payload, authSource } = humanResult;

    req.user = buildHumanUser(payload, authSource);

    auditLog({
      timestamp: new Date().toISOString(),
      type: 'jwt.verified',
      authSubject: req.user.authSubjectId,
      agentId: req.user.agentId,
      principalType: req.user.principalType,
      authSource,
      issuer: req.user.issuer,
      success: true,
    });

    // Log legacy auth usage for tracking
    if (authSource === 'adc_jwt' || authSource === 'adc_legacy') {
      auditLog({
        timestamp: new Date().toISOString(),
        type: 'auth.legacy_used',
        authSubject: req.user.authSubjectId,
        authSource,
        success: true,
      });
    }

    next();
  } catch (err: any) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, 'Token 无效');
  }
});

// ── Middleware: authOptional ────────────────────────────────────────────────

/**
 * Optional authentication — populates req.user if valid token present,
 * silently continues if missing or invalid.
 */
export const authOptional = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) return next();

  // Priority 1: auth-service Agent JWT
  const agentResult = verifyAgentJwt(token);
  if (agentResult) {
    const { claims, authSource } = agentResult;

    try {
      const principal = await resolvePrincipal({
        authSubject: claims.sub,
        agentId: claims.agent_id,
        displayName: claims.agent_id,
        principalType: 'agent',
      });

      req.user = buildAgentUser(claims, principal, authSource);
    } catch {
      // Silently ignore in optional mode
    }
    return next();
  }

  // Priority 2-4: Human JWT
  try {
    const humanResult = verifyHumanJwt(token);
    if (humanResult) {
      const { payload, authSource } = humanResult;
      req.user = buildHumanUser(payload, authSource);
    }
  } catch {
    // Silently ignore
  }
  next();
});
