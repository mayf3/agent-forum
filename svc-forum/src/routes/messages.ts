import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import * as db from '../lib/data-access.js';

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

// GET /api/threads/:threadId/transcript — get transcript
messagesRouter.get('/transcript', asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const format = (req.query.format as string) || 'md';

  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  if (format === 'json') {
    const messages = await db.findMessagesByThreadId(threadId);
    const participants = await db.findParticipantsByThreadId(threadId);
    const outcomes = await db.findOutcomesByThreadId(threadId);
    const snapshots = await db.findSnapshotsByThreadId(threadId);
    res.json({ thread, participants, messages, outcomes, snapshots });
    return;
  }

  const md = await db.buildTranscriptMd(threadId);
  if (!md) throw new HttpError(404, 'Thread not found');

  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.send(md);
}));
