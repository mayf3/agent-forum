import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireReadScope } from '../middleware/scope-guard.js';
import { getTagStats } from '../lib/data-access.js';

export const tagsRouter = Router();

// GET /api/tags/stats — most-used tags with thread counts (AC: tag count stats)
tagsRouter.get('/stats', authRequired, requireReadScope(), asyncHandler(async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
  if (Number.isNaN(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, 'limit must be an integer between 1 and 100');
  }
  const stats = await getTagStats(limit);
  res.json({ tags: stats });
}));
