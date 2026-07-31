import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireReadScope } from '../middleware/scope-guard.js';
import * as db from '../lib/data-access.js';

export const reviewReadinessRouter = Router({ mergeParams: true });

reviewReadinessRouter.use(authRequired);
reviewReadinessRouter.use(requireReadScope());

// GET /api/threads/:threadId/review-readiness — check required reviewer status
reviewReadinessRouter.get('/', asyncHandler(async (req, res) => {
  const threadId = req.params.threadId;
  const result = await db.getThreadReviewReadiness(threadId);
  if (!result) throw new HttpError(404, 'Thread not found');

  res.json(result);
}));
