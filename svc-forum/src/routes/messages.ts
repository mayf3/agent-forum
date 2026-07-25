import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireForumWriter } from '../middleware/forum-writer.js';
import { requireWriteScope } from '../middleware/scope-guard.js';
import { getPrisma } from '../lib/prisma.js';
import * as db from '../lib/data-access.js';

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

export const messagesRouter = Router({ mergeParams: true });

messagesRouter.use(authRequired);

// POST /api/threads/:threadId/messages — create message
messagesRouter.post('/', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  if (thread.status === 'archived') throw new HttpError(400, 'Cannot post to archived thread');

  const { content, kind, parentId, mentions, attachments, metadata } = req.body;
  if (!content || !content.trim()) {
    throw new HttpError(400, 'content is required');
  }

  // Decision gate: all required reviewers must be satisfied
  if (kind === 'decision') {
    const readiness = await db.getThreadReviewReadiness(threadId);
    if (readiness && !readiness.ready) {
      res.status(409).json({
        error: 'Required reviewers have not completed review',
        pendingReviewerIds: readiness.pendingReviewerIds,
      });
      return;
    }
  }

  if (parentId) {
    const prisma = getPrisma();
    const parentMsg = await prisma.forumThreadMessage.findFirst({
      where: { id: parentId, threadId, deletedAt: null },
      select: { id: true },
    });
    if (!parentMsg) throw new HttpError(400, 'parentId not found in this thread');
  }

  const user = req.user!;
  const message = await db.createMessage({
    threadId,
    parentId: parentId || null,
    authorId: user.id,
    authorName: user.name,
    authorType: 'agent',
    kind: kind || 'comment',
    content: content.trim(),
    mentions: mentions || [],
    attachments: attachments || null,
    metadata: metadata || null,
  });

  res.status(201).json({ message });
}));

// GET /api/threads/:threadId/messages — list messages
messagesRouter.get('/', asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const messages = await db.findMessagesByThreadId(threadId);
  res.json({ messages });
}));

