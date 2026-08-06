// watch.ts — 关注/取消关注/已读 + 参与者管理
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { isUuid } from '../../utils/uuid.js';
import { HttpError } from '../../utils/http-error.js';
import { withTransactionRetry } from './shared.js';
import { autowatchThread } from './messages.js';

/**
 * Watch a thread for the current principal (idempotent):
 * absent → create; leftAt≠null → rejoin (gap-covered baseline); already watching → no-op.
 */
export async function watchThread(threadId: string, principalId: string, agentName: string) {
  if (!isUuid(threadId)) throw new HttpError(404, 'Thread not found');
  return withTransactionRetry(async (tx) => {
    const thread = await tx.forumThread.findUnique({
      where: { id: threadId },
      select: { lastMessageAt: true },
    });
    if (!thread) throw new HttpError(404, 'Thread not found');

    const now = new Date();
    const prevMs = thread.lastMessageAt ? thread.lastMessageAt.getTime() : 0;
    await autowatchThread(tx, threadId, principalId, agentName, now, prevMs);

    const participant = await tx.forumThreadParticipant.findUnique({
      where: { threadId_agentId: { threadId, agentId: principalId } },
    });
    return participant;
  });
}

/**
 * Unwatch a thread for the current principal (idempotent): writes leftAt=now.
 */
export async function unwatchThread(threadId: string, principalId: string) {
  if (!isUuid(threadId)) throw new HttpError(404, 'Thread not found');
  return withTransactionRetry(async (tx) => {
    const participant = await tx.forumThreadParticipant.findUnique({
      where: { threadId_agentId: { threadId, agentId: principalId } },
    });
    if (!participant) throw new HttpError(404, 'Not watching this thread');

    if (participant.leftAt !== null) return participant;

    const now = new Date();
    await tx.forumThreadParticipant.update({
      where: { id: participant.id },
      data: { leftAt: now },
    });
    return { ...participant, leftAt: now };
  });
}

/**
 * Mark a thread read for the current principal.
 * lastReadAt = max(previousLastReadAt, latest visible message createdAt)
 */
export async function markThreadRead(threadId: string, principalId: string) {
  if (!isUuid(threadId)) throw new HttpError(404, 'Thread not found');
  return withTransactionRetry(async (tx) => {
    const participant = await tx.forumThreadParticipant.findUnique({
      where: { threadId_agentId: { threadId, agentId: principalId } },
    });
    if (!participant) throw new HttpError(404, 'Not watching this thread');

    const latest = await tx.forumThreadMessage.findFirst({
      where: { threadId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    let next: Date | null = null;
    if (latest) {
      next = participant.lastReadAt && participant.lastReadAt > latest.createdAt
        ? participant.lastReadAt
        : latest.createdAt;
    } else {
      next = participant.lastReadAt;
    }

    if (!next || next.getTime() === participant.lastReadAt?.getTime()) {
      return participant;
    }

    await tx.forumThreadParticipant.update({
      where: { id: participant.id },
      data: { lastReadAt: next },
    });
    return { ...participant, lastReadAt: next };
  });
}

// ── Batch mark threads read ────────────────────────────────

export async function batchMarkRead(threadIds: string[], principalId: string): Promise<{
  updated: number;
  skipped: number;
}> {
  let updated = 0;
  let skipped = 0;

  for (const threadId of threadIds) {
    if (!isUuid(threadId)) {
      skipped++;
      continue;
    }

    const participant = await prisma.forumThreadParticipant.findUnique({
      where: { threadId_agentId: { threadId, agentId: principalId } },
    });
    if (!participant) {
      skipped++;
      continue;
    }

    const latest = await prisma.forumThreadMessage.findFirst({
      where: { threadId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    let next: Date | null = null;
    if (latest) {
      next = participant.lastReadAt && participant.lastReadAt > latest.createdAt
        ? participant.lastReadAt
        : latest.createdAt;
    } else {
      next = participant.lastReadAt;
    }

    if (!next || next.getTime() === participant.lastReadAt?.getTime()) {
      skipped++;
      continue;
    }

    await prisma.forumThreadParticipant.update({
      where: { id: participant.id },
      data: { lastReadAt: next },
    });
    updated++;
  }

  return { updated, skipped };
}

// ── Participants ───────────────────────────────────────────

export async function addParticipant(data: {
  threadId: string;
  agentId: string;
  agentName: string;
  role: string;
  status: string;
}) {
  return prisma.forumThreadParticipant.create({ data });
}

export async function findParticipant(threadId: string, agentId: string) {
  if (!isUuid(threadId)) return null;
  return prisma.forumThreadParticipant.findUnique({
    where: { threadId_agentId: { threadId, agentId } },
  });
}

export async function findParticipantsByThreadId(threadId: string) {
  if (!isUuid(threadId)) return [];
  return prisma.forumThreadParticipant.findMany({
    where: { threadId, leftAt: null },
  });
}

export async function updateParticipant(id: string, data: Prisma.ForumThreadParticipantUpdateInput) {
  return prisma.forumThreadParticipant.update({ where: { id }, data });
}

export async function softDeleteParticipant(id: string) {
  return prisma.forumThreadParticipant.update({
    where: { id },
    data: { leftAt: new Date() },
  });
}
