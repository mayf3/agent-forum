import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireReadScope } from '../middleware/scope-guard.js';
import * as db from '../lib/data-access.js';

export const searchRouter = Router();

searchRouter.use(authRequired);
searchRouter.use(requireReadScope());

// GET /api/search?q=...&page=1&limit=20 — relevance-ranked, paginated search
// (AC: search title + message body, relevance sort + excerpt, forum.read scope,
// pagination support)
searchRouter.get('/', asyncHandler(async (req, res) => {
  const q = (req.query.q as string) || '';
  if (!q.trim()) {
    throw new HttpError(400, 'q (search query) is required');
  }

  const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
  if (Number.isNaN(page) || page < 1) {
    throw new HttpError(400, 'page must be a positive integer');
  }
  if (Number.isNaN(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, 'limit must be an integer between 1 and 100');
  }

  const results = await db.searchAll(q.trim(), page, limit);
  res.json(results);
}));
