import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { env, strictAuth } from '../config/env.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      ok: true,
      service: 'svc-forum',
      db: 'connected',
      signingKeyVersion: env.FORUM_SIGNING_KEY_VERSION,
      strictAuth,
      authIssuer: env.AUTH_JWT_ISSUER,
      authAudience: env.AUTH_JWT_AUDIENCE,
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({ ok: false, service: 'svc-forum', db: 'disconnected' });
  }
});
