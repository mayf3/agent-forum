/**
 * Authentication middleware for svc-forum.
 *
 * Inbound verification uses the standard OAuth access-token path ONLY:
 *   auth-service `client_credentials` token, RS256-signed, verified via JWKS.
 *
 * This is the single production-accepted authentication path. There is:
 *   • NO HS256 shared-secret verification for inbound tokens
 *     (standard OAuth tokens are RS256; a symmetric secret cannot verify them)
 *   • NO ADC JWT / bare-verify fallback
 *   • NO automatic HS256/RS256 selection by token `alg`
 *
 * A successfully verified token resolves (JIT) a local ForumPrincipal and
 * populates req.user, including `scopes` for downstream scope enforcement.
 *
 * ── Error semantics (frozen) ────────────────────────────────────────────────
 * The verifier classifies failures into:
 *   TOKEN_INVALID_OR_EXPIRED (401) — expired / bad sig / unknown kid
 *       → client refreshes once and retries GET; second failure stops.
 *   TOKEN_CONTRACT_INVALID   (401) — wrong iss / aud / type / version /
 *       principal_type / missing claims → client must NOT refresh.
 *   AUTH_JWKS_UNAVAILABLE    (503) — JWKS endpoint down → client must NOT
 *       refresh (prevents a refresh storm when auth-service is briefly down).
 *   INSUFFICIENT_SCOPE       (403) — enforced in scope-guard middleware.
 *
 * authOptional: a missing Authorization header continues as anonymous;
 * a present-but-invalid token is rejected (never silently downgraded).
 */

import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { resolvePrincipal } from '../lib/forum-principal.js';
import { auditLog } from '../lib/audit.js';
import type { PrincipalType, IdentityMode, AuthSource } from '../identity/principal.js';
import {
  verifyAuthAccessToken,
  VerifyTokenError,
  type VerifiedAccessToken,
} from '../lib/auth-jwt.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type { AuthSource };

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
        /** Source of authentication. */
        authSource: AuthSource;
        /** Scopes from the agent JWT. */
        scopes: string[];
        /** Real OAuth machine client_id from the JWT. */
        clientId?: string;
      };
    }
  }
}

/** The only auth source accepted for inbound requests (standard OAuth). */
const STANDARD_OAUTH_SOURCE: AuthSource = 'auth_service_agent_jwt';

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract Bearer token from Authorization header.
 */
function extractToken(req: Request): string | null {
  const auth = req.header('authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Parse scope string into sorted unique array.
 */
function parseScope(scope: string): string[] {
  if (!scope || !scope.trim()) return [];
  return [...new Set(scope.trim().split(/\s+/))].sort();
}

// ── Build req.user ─────────────────────────────────────────────────────────

/**
 * Build req.user from a verified standard OAuth access token and the resolved
 * ForumPrincipal.
 *
 * Display name: standard OAuth tokens carry no `name` claim (correct contract).
 * The local display name is the agent_id fallback — no Profile lookup, no Auth
 * sync. This is a known display debt (LOCAL_DISPLAY_NAME_LOOKUP_IMPLEMENTED=false).
 *
 * Role: 'operator' when the business agent_id is listed in
 * FORUM_OPERATOR_AGENT_IDS (dedicated ops machine principal), otherwise
 * 'agent'. The role drives content-write guards (operators govern, they do
 * not author); governance permission itself is scope-based, never role-based.
 */
function buildAgentUser(
  verified: VerifiedAccessToken,
  principal: { id: string; authSubject: string; agentId: string | null; displayName: string | null; status: string },
) {
  const scopes = parseScope([...verified.scopes].join(' '));
  const isOperator =
    !!verified.agentId && env.FORUM_OPERATOR_AGENT_IDS.includes(verified.agentId);
  return {
    id: principal.id,
    // No `name` claim in standard tokens → fall back to agent_id.
    name: verified.agentId || principal.displayName || principal.id,
    role: isOperator ? 'operator' : 'agent',
    source: STANDARD_OAUTH_SOURCE,
    permissions: [],
    authSubjectId: verified.principalId,
    agentId: verified.agentId,
    principalType: (isOperator ? 'operator' : 'agent') as PrincipalType,
    issuer: env.AUTH_JWT_ISSUER,
    identityMode: 'legacy-sub' as IdentityMode,
    authSource: STANDARD_OAUTH_SOURCE,
    scopes,
    clientId: verified.clientId,
  };
}

// ── Error mapping ──────────────────────────────────────────────────────────

/**
 * Map a VerifyTokenError to the HTTP error surfaced to the client.
 *
 * 401 (both refreshable and contract): the token itself is the problem.
 * 503: the JWKS infrastructure is the problem — client must not refresh.
 */
function verifyErrorToHttp(err: VerifyTokenError): HttpError {
  if (err.code === 'AUTH_JWKS_UNAVAILABLE') {
    return new HttpError(503, 'AUTH_JWKS_UNAVAILABLE');
  }
  // Both TOKEN_INVALID_OR_EXPIRED and TOKEN_CONTRACT_INVALID are 401; the
  // distinct code is carried in the message so clients can decide whether to
  // refresh (only TOKEN_INVALID_OR_EXPIRED is refreshable).
  return new HttpError(401, err.code);
}

// ── Core verification + principal resolution ───────────────────────────────

/**
 * Verify a standard OAuth access token and resolve the local ForumPrincipal.
 * Returns req.user fields, or throws an HttpError (401/503).
 */
async function verifyAndResolve(token: string) {
  let verified: VerifiedAccessToken;
  try {
    verified = await verifyAuthAccessToken(token);
  } catch (err) {
    if (err instanceof VerifyTokenError) {
      auditLog({
        timestamp: new Date().toISOString(),
        type: 'jwt.failed',
        success: false,
        errorCategory: err.code,
      });
      throw verifyErrorToHttp(err);
    }
    // Unexpected error — do not leak internals; treat as refreshable invalid.
    auditLog({
      timestamp: new Date().toISOString(),
      type: 'jwt.failed',
      success: false,
      errorCategory: 'TOKEN_INVALID_OR_EXPIRED',
    });
    throw new HttpError(401, 'TOKEN_INVALID_OR_EXPIRED');
  }

  // JIT: resolve/create ForumPrincipal from the verified authSubject.
  try {
    const isOperator =
      !!verified.agentId && env.FORUM_OPERATOR_AGENT_IDS.includes(verified.agentId);
    const principal = await resolvePrincipal({
      authSubject: verified.principalId,
      agentId: verified.agentId,
      displayName: verified.agentId,
      principalType: isOperator ? 'operator' : 'agent',
    });
    return buildAgentUser(verified, principal);
  } catch (err: any) {
    if (err instanceof HttpError) {
      // Map 409 identity conflicts to 401 for the caller.
      if (err.statusCode === 409) {
        throw new HttpError(401, `Identity conflict: ${err.message}`);
      }
      throw err;
    }
    throw new HttpError(500, 'Failed to resolve agent identity');
  }
}

// ── Middleware: authRequired ────────────────────────────────────────────────

/**
 * Required authentication middleware.
 * Verifies a standard OAuth access token and populates req.user.
 *
 * @throws 401 TOKEN_INVALID_OR_EXPIRED / TOKEN_CONTRACT_INVALID on token failure.
 * @throws 503 AUTH_JWKS_UNAVAILABLE when the JWKS endpoint is unreachable.
 */
export const authRequired = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) {
    throw new HttpError(401, '请先登录');
  }

  const user = await verifyAndResolve(token);

  auditLog({
    timestamp: new Date().toISOString(),
    type: 'jwt.verified',
    authSubject: user.authSubjectId,
    agentId: user.agentId,
    principalType: 'agent',
    authSource: user.authSource,
    issuer: user.issuer,
    audience: env.AUTH_JWT_SVC_FORUM_AUDIENCE,
    scope: user.scopes.join(' '),
    success: true,
  });

  req.user = user;
  next();
});

// ── Middleware: authOptional ────────────────────────────────────────────────

/**
 * Optional authentication — frozen semantics:
 *   • No Authorization header → continue as anonymous (req.user unset).
 *   • Present-but-invalid token → 401 (never silently downgraded to anonymous).
 *   • JWKS endpoint unavailable → 503.
 *
 * Downgrading an invalid token to anonymous would produce confusing permission
 * behavior, so invalid tokens always reject here.
 */
export const authOptional = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) return next();

  const user = await verifyAndResolve(token);

  auditLog({
    timestamp: new Date().toISOString(),
    type: 'jwt.verified',
    authSubject: user.authSubjectId,
    agentId: user.agentId,
    principalType: 'agent',
    authSource: user.authSource,
    issuer: user.issuer,
    audience: env.AUTH_JWT_SVC_FORUM_AUDIENCE,
    scope: user.scopes.join(' '),
    success: true,
  });

  req.user = user;
  next();
});
