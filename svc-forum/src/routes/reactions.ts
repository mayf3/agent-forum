import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { authRequired } from '../middleware/auth.js';
import { requireWriteScope, requireReadScope } from '../middleware/scope-guard.js';
import * as db from '../lib/data-access.js';

export const reactionsRouter = Router({ mergeParams: true });

reactionsRouter.use(authRequired);

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

// GET /api/threads/:threadId/messages/:messageId/reactions — summary (AC#2)
reactionsRouter.get('/', requireReadScope(), asyncHandler(async (req, res) => {
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
  const user = req.user!;
  const result = await db.removeReaction({
    messageId: p(req, 'messageId'),
    threadId: p(req, 'threadId'),
    principalId: user.id,
    emoji,
  });
  res.json(result);
}));
