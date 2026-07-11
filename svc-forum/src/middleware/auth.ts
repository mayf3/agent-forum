import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
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
 * JWT verification — required auth.
 * Verifies tokens signed by ADC (JWT_SECRET) or auth-service (AUTH_JWT_SECRET).
 */
export const authRequired = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');

  if (!token) {
    throw new HttpError(401, '请先登录');
  }

  let payload: jwt.JwtPayload & {
    sub?: string; name?: string; role?: string; permissions?: string[]; agentId?: string;
  } | null = null;

  // Priority 1: auth-service JWT
  if (env.AUTH_JWT_SECRET) {
    try {
      payload = jwt.verify(token, env.AUTH_JWT_SECRET, {
        issuer: env.AUTH_JWT_ISSUER,
        audience: env.AUTH_JWT_AUDIENCE,
      }) as any;
    } catch {
      // fall through
    }
  }

  // Priority 2: ADC JWT
  if (!payload) {
    try {
      payload = jwt.verify(token, env.JWT_SECRET, {
        issuer: ADC_JWT_ISSUER,
        audience: ADC_JWT_AUDIENCE,
      }) as any;
    } catch {
      // fall through
    }
  }

  // Priority 3: ADC JWT without issuer/audience (backward compat)
  if (!payload) {
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as any;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new HttpError(401, 'TOKEN_EXPIRED');
      }
      throw new HttpError(401, 'Token 无效');
    }
  }

  req.user = {
    id: payload!.sub || '',
    name: payload!.name || payload!.sub || '',
    role: payload!.role,
    source: 'jwt',
    permissions: payload!.permissions || [],
    agentId: payload!.agentId,
  };

  next();
});

/**
 * Optional auth — populates req.user if token present, doesn't fail if missing.
 */
export const authOptional = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return next();

  try {
    if (env.AUTH_JWT_SECRET) {
      try {
        const payload = jwt.verify(token, env.AUTH_JWT_SECRET, {
          issuer: env.AUTH_JWT_ISSUER,
          audience: env.AUTH_JWT_AUDIENCE,
        }) as any;
        req.user = { id: payload.sub || '', name: payload.name || '', role: payload.role, source: 'auth-service', permissions: payload.permissions || [], agentId: payload.agentId };
        return next();
      } catch {
        // fall through
      }
    }

    const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload & {
      sub?: string; name?: string; role?: string; agentId?: string;
    };
    req.user = { id: payload.sub || '', name: payload.name || '', role: payload.role, source: 'adc', agentId: payload.agentId };
  } catch {
    // Silently ignore
  }
  next();
});
