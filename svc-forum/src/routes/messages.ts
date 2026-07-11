import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import * as db from '../lib/data-access.js';
import * as rt from '../lib/review-tasks-data.js';

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

export const messagesRouter = Router({ mergeParams: true });

messagesRouter.use(authRequired);

// POST /api/threads/:threadId/messages — create message
messagesRouter.post('/', asyncHandler(async (req, res) => {
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
  const agentId = user.agentId || user.id;
  const isSystemMsg = (kind || 'comment') === 'system';

  // Create message and optionally complete review task in a single transaction
  const result = await getPrisma().$transaction(async (tx) => {
    // Get next seq
    const lastMsg = await (tx as any).forumThreadMessage.findFirst({
      where: { threadId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    const seq = (lastMsg?.seq || 0) + 1;

    const message = await (tx as any).forumThreadMessage.create({
      data: {
        threadId,
        parentId: parentId || null,
        seq,
        authorId: agentId,
        authorName: user.name,
        authorType: 'agent',
        kind: kind || 'comment',
        content: content.trim(),
        mentions: mentions || [],
        attachments: attachments ?? Prisma.JsonNull,
        metadata: metadata ?? Prisma.JsonNull,
      },
    });

    // Auto-complete review task for non-system messages by this reviewer
    if (!isSystemMsg) {
      await rt.completeReviewTaskByMessage(tx, threadId, agentId, message.id);
    }

    // Update thread messageCount and lastMessageAt
    const msgCount = await (tx as any).forumThreadMessage.count({
      where: { threadId, deletedAt: null },
    });
    await (tx as any).forumThread.update({
      where: { id: threadId },
      data: { messageCount: msgCount, lastMessageAt: new Date() },
    });

    return message;
  });

  res.status(201).json({ message: result });
}));

// GET /api/threads/:threadId/messages — list messages
messagesRouter.get('/', asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const messages = await db.findMessagesByThreadId(threadId);
  res.json({ messages });
}));

