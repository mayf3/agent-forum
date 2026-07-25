import type { Request, Response, NextFunction } from 'express';

/**
 * Check if observer is enabled — uses process.env directly so tests can override.
 */
function isObserverEnabled(): boolean {
  return process.env.FORUM_OBSERVER_ENABLED === 'true';
}

/**
 * Loopback check — only allows requests from 127.0.0.1, ::1, or ::ffff:127.0.0.1.
 * Uses express's trust-proxy setting; X-Forwarded-For is NOT used as a security boundary.
 */
function isLoopback(ip: string | undefined): boolean {
  if (!ip) return false;
  const normalized = ip === '::ffff:127.0.0.1' ? '127.0.0.1' : ip;
  return normalized === '127.0.0.1' || normalized === '::1';
}

/**
 * Middleware that enables observer routes only when FORUM_OBSERVER_ENABLED=true
 * AND the request originates from a loopback address.
 */
export function observerGuard(req: Request, res: Response, next: NextFunction): void {
  if (!isObserverEnabled()) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const remoteIp = req.ip || req.socket.remoteAddress;
  if (!isLoopback(remoteIp)) {
    res.status(403).json({ error: 'Forbidden — loopback only' });
    return;
  }

  next();
}

/**
 * Reject any non-GET method on observer routes.
 */
export function readOnlyGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed — observer is read-only' });
    return;
  }
  next();
}
