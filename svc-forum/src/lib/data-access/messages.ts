// messages.ts — 消息 CRUD + autowatchThread 私有 helper
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { isUuid } from '../../utils/uuid.js';
import { HttpError } from '../../utils/http-error.js';
import { withTransactionRetry } from './shared.js';

export interface CreateMessageInput {
  threadId: string;
  parentId?: string | null;
  authorId: string;
  authorName: string;
  authorType: string;
  kind: string;
  content: string;
  mentions?: string[];
  /** Resolved by the caller (outside the transaction) — business agent_id → ForumPrincipal.id */
  mentionPrincipals?: Array<{ agentId: string; principalId: string; displayName: string | null }>;
  attachments?: any;
  metadata?: any;
}

/**
 * Watch / re-watch a thread for a principal. Only touches watch fields:
 * joinedAt / leftAt / agentId / agentName. Never overwrites role, status,
 * reviewWaived*, or lastReadAt. Must be called inside the write transaction
 * (tx) so it never races the message create.
 *
 * joinedAt semantics (Codex-confirmed millisecond hazard):
 *   joinedAt = max(t0, prevLastMessageAtMs)
 */
export async function autowatchThread(
  tx: Prisma.TransactionClient,
  threadId: string,
  principalId: string,
  agentName: string,
  t0: Date,
  prevLastMessageAtMs: number,
) {
  const existing = await tx.forumThreadParticipant.findUnique({
    where: { threadId_agentId: { threadId, agentId: principalId } },
  });

  const joinedAt = new Date(Math.max(t0.getTime(), prevLastMessageAtMs));

  if (!existing) {
    await tx.forumThreadParticipant.create({
      data: {
        threadId,
        agentId: principalId,
        agentName,
        role: 'member',
        status: 'active',
        joinedAt,
      },
    });
    return;
  }

  if (existing.leftAt !== null) {
    await tx.forumThreadParticipant.update({
      where: { id: existing.id },
      data: { leftAt: null, joinedAt },
    });
  }
  // Already watching → no-op.
}

/**
 * Create a message, advance the thread, and autowatch the author plus every
 * mentioned agent — all in ONE retryable transaction.
 *
 * Timestamp ordering: t1 = max(t0 + 1ms, previous thread.lastMessageAt + 1ms)
 * so message.createdAt is STRICTLY greater than the participant's unread baseline.
 */
export async function createMessage(data: CreateMessageInput) {
  return withTransactionRetry(async (tx) => {
    const t0 = new Date();

    const thread = await tx.forumThread.findUnique({
      where: { id: data.threadId },
      select: { lastMessageAt: true },
    });
    if (!thread) throw new HttpError(404, 'Thread not found');

    const prevTime = thread.lastMessageAt ? thread.lastMessageAt.getTime() : 0;
    const t1 = new Date(Math.max(t0.getTime() + 1, prevTime + 1));

    const lastMsg = await tx.forumThreadMessage.findFirst({
      where: { threadId: data.threadId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    const seq = (lastMsg?.seq || 0) + 1;

    const message = await tx.forumThreadMessage.create({
      data: {
        threadId: data.threadId,
        parentId: data.parentId || null,
        seq,
        authorId: data.authorId,
        authorName: data.authorName,
        authorType: data.authorType,
        kind: data.kind,
        content: data.content,
        mentions: data.mentions || [],
        createdAt: t1,
        attachments: data.attachments ?? Prisma.JsonNull,
        metadata: data.metadata ?? Prisma.JsonNull,
      },
    });

    const msgCount = await tx.forumThreadMessage.count({
      where: { threadId: data.threadId, deletedAt: null },
    });
    await tx.forumThread.update({
      where: { id: data.threadId },
      data: { messageCount: msgCount, lastMessageAt: t1 },
    });

    // Author autowatch
    await autowatchThread(tx, data.threadId, data.authorId, data.authorName, t0, prevTime);

    // Mentioned agents autowatch (principal ids resolved by the caller)
    for (const m of data.mentionPrincipals || []) {
      await autowatchThread(tx, data.threadId, m.principalId, m.displayName || m.agentId, t0, prevTime);
    }

    return message;
  });
}

export async function findMessagesByThreadId(threadId: string) {
  if (!isUuid(threadId)) return [];
  return prisma.forumThreadMessage.findMany({
    where: { threadId, deletedAt: null },
    orderBy: { seq: 'asc' },
  });
}

export async function softDeleteMessage(id: string) {
  return prisma.forumThreadMessage.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}
