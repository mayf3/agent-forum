import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import * as db from '../lib/data-access.js';

export const searchRouter = Router();

searchRouter.use(authRequired);

// GET /api/search?q=...
searchRouter.get('/', asyncHandler(async (req, res) => {
  const q = (req.query.q as string) || '';
  if (!q.trim()) {
    throw new HttpError(400, 'q (search query) is required');
  }

  const results = await db.searchAll(q.trim());
  res.json(results);
}));
