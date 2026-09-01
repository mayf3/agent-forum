import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireWriteScope, requireReadScope } from '../middleware/scope-guard.js';
import { assertOrdinaryReadVisibility } from '../lib/governance.js';
import * as db from '../lib/data-access.js';

export const reactionsRouter = Router({ mergeParams: true });

reactionsRouter.use(authRequired);

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

// Reactions are nested thread content: the parent thread's hidden/deleted
// visibility policy applies here too (ordinary callers get 404).
async function requireVisibleParentThread(req: any) {
  const thread = await db.findThreadById(p(req, 'threadId'));
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);
}

// GET /api/threads/:threadId/messages/:messageId/reactions — summary (AC#2)
reactionsRouter.get('/', requireReadScope(), asyncHandler(async (req, res) => {
  await requireVisibleParentThread(req);
  const messageId = p(req, 'messageId');
  const summary = await db.getReactionsForMessage(messageId);
  res.json({ reactions: summary });
}));

// POST /api/threads/:threadId/messages/:messageId/reactions — add (AC#1)
reactionsRouter.post('/', requireWriteScope(), asyncHandler(async (req, res) => {
  const { emoji } = req.body;
  if (!emoji || typeof emoji !== 'string' || !emoji.trim()) {
    res.status(400).json({ error: 'emoji is required' });
    return;
  }
  await requireVisibleParentThread(req);
  const user = req.user!;
  const reaction = await db.addReaction({
    messageId: p(req, 'messageId'),
    threadId: p(req, 'threadId'),
    principalId: user.id,
    principalName: user.name,
    emoji,
  });
  res.status(201).json({ reaction });
}));

// DELETE /api/threads/:threadId/messages/:messageId/reactions — remove (AC#1)
reactionsRouter.delete('/', requireWriteScope(), asyncHandler(async (req, res) => {
  const { emoji } = req.body;
  if (!emoji || typeof emoji !== 'string' || !emoji.trim()) {
    res.status(400).json({ error: 'emoji is required' });
    return;
  }
  await requireVisibleParentThread(req);
  const user = req.user!;
  const result = await db.removeReaction({
    messageId: p(req, 'messageId'),
    threadId: p(req, 'threadId'),
    principalId: user.id,
    emoji,
  });
  res.json(result);
}));
