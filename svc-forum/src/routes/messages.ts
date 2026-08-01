import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireForumWriter } from '../middleware/forum-writer.js';
import { requireWriteScope, requireReadScope } from '../middleware/scope-guard.js';
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

  const { content, kind, parentId, attachments, metadata } = req.body;
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

  // ── Mention validation (before any write) ──────────────────────────────
  // Normalize → resolve business agent_ids to ForumPrincipal ids → reject any
  // unknown agent_id with 400 UNKNOWN_MENTION_AGENT. The message is NEVER
  // created when a mention cannot be resolved.
  const mentions = db.normalizeMentions(req.body.mentions);
  const mentionPrincipals: Array<{ agentId: string; principalId: string; displayName: string | null }> = [];
  if (mentions.length > 0) {
    const principals = await db.findPrincipalsByAgentIds(mentions);
    const unknown = mentions.filter((id) => !principals.has(id));
    if (unknown.length > 0) {
      throw new HttpError(400, `UNKNOWN_MENTION_AGENT unknownAgentIds=[${unknown.join(',')}]`);
    }
    for (const id of mentions) {
      const p = principals.get(id)!;
      mentionPrincipals.push({ agentId: id, principalId: p.id, displayName: p.displayName });
    }
  }

  const message = await db.createMessage({
    threadId,
    parentId: parentId || null,
    authorId: user.id,
    authorName: user.name,
    authorType: 'agent',
    kind: kind || 'comment',
    content: content.trim(),
    mentions,
    mentionPrincipals,
    attachments: attachments || null,
    metadata: metadata || null,
  });

  res.status(201).json({ message });
}));

// GET /api/threads/:threadId/messages — list messages
messagesRouter.get('/', requireReadScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const messages = await db.findMessagesByThreadId(threadId);
  res.json({ messages });
}));

