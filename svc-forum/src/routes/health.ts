import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, service: 'svc-forum', db: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false, service: 'svc-forum', db: 'disconnected' });
  }
});
