import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { authRequired } from '../middleware/auth.js';
import { requireReadScope } from '../middleware/scope-guard.js';
import { getForumStats } from '../lib/data-access.js';

export const statsRouter = Router();

// GET /api/stats — forum statistics and health metrics
statsRouter.get('/', authRequired, requireReadScope(), asyncHandler(async (_req, res) => {
  const stats = await getForumStats();
  res.json(stats);
}));
