import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireForumWriter } from '../middleware/forum-writer.js';
import { requireWriteScope, requireReadScope, requireGovernanceScopes } from '../middleware/scope-guard.js';
import { getPrisma } from '../lib/prisma.js';
import {
  applyGovernanceAction,
  assertOrdinaryReadVisibility,
  hasGovernanceAuthority,
  MESSAGE_BLOCKING_STATUSES,
} from '../lib/governance.js';
import { createNotificationFacts } from '../lib/data-access/notification-store.js';
import { repairThreadMessageDerivedState } from '../lib/data-access/messages.js';
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

  // Ordinary callers cannot even see hidden/deleted threads — posting must
  // not leak their existence either (404, same as nonexistent). Governance
  // callers see them and get the honest "cannot post" state error.
  assertOrdinaryReadVisibility(thread, req.user?.scopes);

  if (MESSAGE_BLOCKING_STATUSES.includes(thread.status)) {
    throw new HttpError(400, `Cannot post to ${thread.status} thread`);
  }

  const { content, kind, parentId, attachments, metadata } = req.body;
  if (!content || !content.trim()) {
    throw new HttpError(400, 'content is required');
  }

  // system/decision kinds require forum.moderate scope
  if (kind === 'system' || kind === 'decision') {
    if (!hasGovernanceAuthority(req.user?.scopes)) {
      throw new HttpError(403, 'INSUFFICIENT_SCOPE: "forum.moderate" required for system/decision messages');
    }
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

  // ── Mention resolution (before any write) ──────────────────────────────
  // Two sources, unioned:
  //   1. explicit body mentions — strict: unknown agent → 400, never created
  //   2. @agent-id tokens parsed from content — heuristic: tokens that do not
  //      resolve to a known agent are dropped (prose may contain @-like text)
  const explicitMentions = db.normalizeMentions(req.body.mentions);
  const contentMentions = db.extractMentionsFromContent(content.trim());
  const candidateMentions = [...new Set([...explicitMentions, ...contentMentions])];

  const mentionPrincipals: Array<{ agentId: string; principalId: string; displayName: string | null }> = [];
  if (candidateMentions.length > 0) {
    const principals = await db.findPrincipalsByAgentIds(candidateMentions);
    const unknown = explicitMentions.filter((id) => !principals.has(id));
    if (unknown.length > 0) {
      throw new HttpError(400, `UNKNOWN_MENTION_AGENT unknownAgentIds=[${unknown.join(',')}]`);
    }
    for (const id of candidateMentions) {
      const principal = principals.get(id);
      if (!principal) continue; // content-parsed token that matches no agent
      mentionPrincipals.push({ agentId: id, principalId: principal.id, displayName: principal.displayName });
    }
  }

  const mentions = mentionPrincipals.map((m) => m.agentId);

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

  // ── Mention notifications (Governance V1) ──────────────────────────────
  // One materialized notification fact per mentioned principal, excluding
  // the author, keyed idempotently on the message id. Content writes are not
  // governance actions (no audit requirement), so this fan-out stays
  // best-effort AFTER the message is durable: a fan-out failure must not
  // fail the posted message.
  const mentionedPrincipals = mentionPrincipals.filter(
    (m) => m.principalId !== user.id,
  );
  if (mentionedPrincipals.length > 0) {
    try {
      await createNotificationFacts(
        mentionedPrincipals.map((m) => ({
          recipientPrincipalId: m.principalId,
          threadId,
          messageId: message.id,
          reason: 'mention' as const,
          sourceEventKey: `mention:${message.id}`,
          payload: {
            mentionedAgentId: m.agentId,
            authorAgentId: user.agentId ?? null,
            authorName: user.name,
            threadTitle: thread.title,
          },
        })),
      );
    } catch (err: any) {
      console.error('[NOTIFICATION] mention fan-out failed:', err?.message);
    }
  }

  res.status(201).json({ message });
}));

// GET /api/threads/:threadId/messages — list messages
// Unified visibility policy: hidden/deleted threads' messages are 404 for
// ordinary callers — no "detail 404 but /messages 200" split surface.
messagesRouter.get('/', requireReadScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);

  const messages = await db.findMessagesByThreadId(threadId);
  res.json({ messages });
}));

// DELETE /api/threads/:threadId/messages/:messageId — soft delete message (moderator/admin only)
messagesRouter.delete('/:messageId', requireGovernanceScopes(), requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const messageId = p(req, 'messageId');

  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);

  const prisma = getPrisma();
  const message = await prisma.forumThreadMessage.findFirst({
    where: { id: messageId, threadId, deletedAt: null },
    select: { id: true },
  });
  if (!message) throw new HttpError(404, 'Message not found');

  const user = req.user!;

  // Single transaction: audit append → tombstone flip → derived repair
  // (messageCount/lastMessageAt recompute, CTR-DELETE-002) → participant
  // notices. Review readiness derives from visible messages at read time,
  // so no stored readiness needs repairing here.
  await applyGovernanceAction(
    {
      actor: {
        id: user.id,
        authSubject: user.authSubjectId,
        agentId: user.agentId,
        clientId: user.clientId,
        name: user.name,
        scopes: user.scopes,
      },
      eventType: 'message.soft_delete',
      targetType: 'message',
      targetId: messageId,
      threadId,
      revision: thread.currentRevision ?? null,
      notifyReason: 'moderator_notice',
    },
    async (tx) => {
      const updated = await tx.forumThreadMessage.update({
        where: { id: messageId },
        data: { deletedAt: new Date() },
      });
      await repairThreadMessageDerivedState(tx, threadId);
      return updated;
    },
  );

  res.json({ ok: true });
}));

