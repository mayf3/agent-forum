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
      select: { lastMessageAt: true, status: true },
    });
    if (!thread || thread.status === 'deleted') throw new HttpError(404, 'Thread not found');

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
    const thread = await tx.forumThread.findUnique({
      where: { id: threadId },
      select: { status: true },
    });
    if (!thread || thread.status === 'deleted') throw new HttpError(404, 'Thread not found');

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
    const thread = await tx.forumThread.findUnique({
      where: { id: threadId },
      select: { status: true },
    });
    if (!thread || thread.status === 'deleted') throw new HttpError(404, 'Thread not found');

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

    const thread = await prisma.forumThread.findUnique({
      where: { id: threadId },
      select: { status: true },
    });
    if (!thread || thread.status === 'deleted') {
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

const PARTICIPANT_CREATE_ROLES = new Set(['creator', 'member', 'required_reviewer']);
const PARTICIPANT_MUTABLE_ROLES = new Set(['member', 'required_reviewer']);
const PARTICIPANT_STATUSES = new Set(['active', 'invited', 'responded']);

export async function addParticipant(data: {
  threadId: string;
  agentId: string;
  agentName: string;
  role: string;
  status: string;
}) {
  if (!PARTICIPANT_CREATE_ROLES.has(data.role)) {
    throw new HttpError(400, 'role must be creator, member, or required_reviewer');
  }
  if (!PARTICIPANT_STATUSES.has(data.status)) {
    throw new HttpError(400, 'status must be active, invited, or responded');
  }
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
  if (!isUuid(id)) throw new HttpError(404, 'Participant not found');
  const keys = Object.keys(data);
  const isPresentationUpdate = keys.length > 0 && keys.every((key) => key === 'role' || key === 'status');
  const isWaiverCommit = keys.length === 3
    && keys.includes('reviewWaivedAt')
    && keys.includes('reviewWaivedById')
    && keys.includes('reviewWaiverReason');

  if (isPresentationUpdate) {
    if (data.role !== undefined && (typeof data.role !== 'string' || !PARTICIPANT_MUTABLE_ROLES.has(data.role))) {
      throw new HttpError(400, 'role must be member or required_reviewer');
    }
    if (data.status !== undefined && (typeof data.status !== 'string' || !PARTICIPANT_STATUSES.has(data.status))) {
      throw new HttpError(400, 'status must be active, invited, or responded');
    }
  } else if (isWaiverCommit) {
    if (
      !(data.reviewWaivedAt instanceof Date)
      || typeof data.reviewWaivedById !== 'string'
      || typeof data.reviewWaiverReason !== 'string'
      || !data.reviewWaiverReason.trim()
    ) {
      throw new HttpError(400, 'waiver commit requires actor, time, and non-empty reason');
    }
  } else {
    throw new HttpError(
      400,
      'Participant update may change only presentation role/status or commit a complete review waiver',
    );
  }
  return prisma.forumThreadParticipant.update({ where: { id }, data });
}

export async function softDeleteParticipant(id: string) {
  if (!isUuid(id)) throw new HttpError(404, 'Participant not found');
  const participant = await prisma.forumThreadParticipant.findUnique({
    where: { id },
    select: { id: true, leftAt: true },
  });
  if (!participant || participant.leftAt) throw new HttpError(404, 'Participant not found');
  throw new HttpError(
    409,
    'LEGACY_PARTICIPANT_REMOVE_DISABLED: participant removal must not mutate Watch or Read State',
  );
}
