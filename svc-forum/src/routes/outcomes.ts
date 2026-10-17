import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireForumWriter } from '../middleware/forum-writer.js';
import { requireWriteScope, requireReadScope } from '../middleware/scope-guard.js';
import * as db from '../lib/data-access.js';

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

export const outcomesRouter = Router({ mergeParams: true });

outcomesRouter.use(authRequired);

// POST /api/threads/:threadId/outcomes — direct Outcome authority is disabled
outcomesRouter.post('/', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread || thread.status === 'deleted') throw new HttpError(404, 'Thread not found');
  throw new HttpError(409, 'DIRECT_OUTCOME_DISABLED: authoritative outcomes may only be created by Finalization');
}));

// GET /api/threads/:threadId/outcomes — list outcomes
outcomesRouter.get('/', requireReadScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const outcomes = await db.findOutcomesByThreadId(threadId);
  res.json({ outcomes });
}));

// GET /api/threads/:threadId/outcomes/latest — get latest outcome
outcomesRouter.get('/latest', requireReadScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const outcome = await db.findLatestOutcomeByThreadId(threadId);
  res.json({ outcome });
}));
