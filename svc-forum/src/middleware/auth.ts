import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { strictAuth } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';
import { asyncHandler } from '../utils/async-handler.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        role?: string;
        source?: string;
        permissions?: string[];
        agentId?: string;
      };
    }
  }
}

const ADC_JWT_ISSUER = 'agent-dev-center';
const ADC_JWT_AUDIENCE = 'adc-api';

/**
 * Verify a JWT against the auth-service shared secret with issuer/audience.
 * This is the only accepted path in strict (production) mode.
 */
function verifyAuthServiceJwt(token: string): jwt.JwtPayload & {
  sub?: string; name?: string; role?: string; permissions?: string[]; agentId?: string;
} | null {
  if (!env.AUTH_JWT_SECRET) return null;
  try {
    return jwt.verify(token, env.AUTH_JWT_SECRET, {
      issuer: env.AUTH_JWT_ISSUER,
      audience: env.AUTH_JWT_AUDIENCE,
    }) as any;
  } catch {
    return null;
  }
}

/**
 * Verify a legacy ADC JWT with issuer/audience check.
 * Only used in non-strict (development/test) mode.
 */
function verifyAdcJwt(token: string): jwt.JwtPayload & {
  sub?: string; name?: string; role?: string; permissions?: string[]; agentId?: string;
} | null {
  try {
    return jwt.verify(token, env.JWT_SECRET, {
      issuer: ADC_JWT_ISSUER,
      audience: ADC_JWT_AUDIENCE,
    }) as any;
  } catch {
    return null;
  }
}

/**
 * Verify a bare JWT with JWT_SECRET (no issuer/audience).
 * Only used in non-strict (development/test) mode — backward compat only.
 */
function verifyBareJwt(token: string): jwt.JwtPayload & {
  sub?: string; name?: string; role?: string; permissions?: string[]; agentId?: string;
} | null {
  try {
    return jwt.verify(token, env.JWT_SECRET) as any;
  } catch {
    return null;
  }
}

/**
 * Map JWT payload fields to a normalized user object.
 * Handles both camelCase (ADC JWT) and snake_case (auth-service JWT) field names.
 */
function payloadToUser(payload: any, source = 'jwt') {
  const user: {
    id: string; name: string; role?: string; source?: string;
    permissions?: string[]; agentId?: string;
  } = {
    id: payload.sub || '',
    name: payload.name || payload.sub || '',
    role: payload.role || payload.principal_type || 'user',
    source,
    permissions: payload.permissions || [],
    agentId: payload.agentId || payload.agent_id || '',
  };
  return user;
}

/**
 * JWT verification — required auth.
 *
 * In strict mode (NODE_ENV=production or FORUM_STRICT_AUTH=true):
 *   Only accepts auth-service JWT with correct issuer (auth-service) and
 *   audience (svc-forum). Legacy ADC tokens and bare-verify fallback are
 *   rejected.
 *
 * In non-strict mode (development/test):
 *   Falls through three priority levels for backward compatibility.
 */
export const authRequired = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');

  if (!token) {
    throw new HttpError(401, '请先登录');
  }

  if (strictAuth) {
    // ── Strict mode: only auth-service JWTs accepted ──────────────────
    const payload = verifyAuthServiceJwt(token);
    if (!payload) {
      throw new HttpError(401, 'TOKEN_INVALID_OR_EXPIRED');
    }
    req.user = payloadToUser(payload);
    next();
    return;
  }

  // ── Non-strict mode: three priority levels (development backward compat) ──

  // Priority 1: auth-service JWT
  let payload = verifyAuthServiceJwt(token);
  if (payload) {
    req.user = payloadToUser(payload);
    next();
    return;
  }

  // Priority 2: ADC JWT with issuer/audience
  payload = verifyAdcJwt(token);
  if (payload) {
    req.user = payloadToUser(payload);
    next();
    return;
  }

  // Priority 3: ADC JWT bare verify (no issuer/audience)
  payload = verifyBareJwt(token);
  if (payload) {
    req.user = payloadToUser(payload);
    next();
    return;
  }

  // All verification paths failed
  throw new HttpError(401, 'Token 无效');
});

/**
 * Optional auth — populates req.user if token present, doesn't fail if missing.
 *
 * In strict mode, only auth-service tokens are accepted.
 * In non-strict mode, falls back to ADC bare-verify for backward compatibility.
 */
export const authOptional = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return next();

  if (strictAuth) {
    // Strict mode: only auth-service JWT
    const payload = verifyAuthServiceJwt(token);
    if (payload) {
      req.user = payloadToUser(payload);
    }
    next();
    return;
  }

  // Non-strict mode: try auth-service first, then ADC bare-verify
  let authPayload = verifyAuthServiceJwt(token);
  if (authPayload) {
    req.user = payloadToUser(authPayload, 'auth-service');
    return next();
  }

  authPayload = verifyBareJwt(token);
  if (authPayload) {
    req.user = payloadToUser(authPayload, 'adc');
  }
  next();
});
