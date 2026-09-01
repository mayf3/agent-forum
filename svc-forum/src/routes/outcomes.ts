import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireForumWriter } from '../middleware/forum-writer.js';
import { requireWriteScope, requireReadScope } from '../middleware/scope-guard.js';
import { assertOrdinaryReadVisibility } from '../lib/governance.js';
import * as db from '../lib/data-access.js';

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

export const outcomesRouter = Router({ mergeParams: true });

outcomesRouter.use(authRequired);

// POST /api/threads/:threadId/outcomes — create outcome
outcomesRouter.post('/', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);

  const {
    summaryMd, decisionsJson, actionItemsJson,
    rejectedOptionsJson, openQuestionsJson,
    writebackTargetType, writebackTargetRef,
  } = req.body;

  if (!summaryMd || !summaryMd.trim()) {
    throw new HttpError(400, 'summaryMd is required');
  }

  const user = req.user!;
  const outcome = await db.createOutcome({
    threadId,
    summaryMd: summaryMd.trim(),
    decisionsJson: decisionsJson || null,
    actionItemsJson: actionItemsJson || null,
    rejectedOptionsJson: rejectedOptionsJson || null,
    openQuestionsJson: openQuestionsJson || null,
    writebackTargetType: writebackTargetType || null,
    writebackTargetRef: writebackTargetRef || null,
    createdById: user.id,
    createdByName: user.name,
  });

  res.status(201).json({ outcome });
}));

// GET /api/threads/:threadId/outcomes — list outcomes
outcomesRouter.get('/', requireReadScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);

  const outcomes = await db.findOutcomesByThreadId(threadId);
  res.json({ outcomes });
}));

// GET /api/threads/:threadId/outcomes/latest — get latest outcome
outcomesRouter.get('/latest', requireReadScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);

  const outcome = await db.findLatestOutcomeByThreadId(threadId);
  res.json({ outcome });
}));
