// outcomes.ts — 结论管理
import { prisma } from '../prisma.js';
import { isUuid } from '../../utils/uuid.js';
import { HttpError } from '../../utils/http-error.js';

export async function createOutcome(data: {
  threadId: string;
  summaryMd: string;
  decisionsJson?: any;
  actionItemsJson?: any;
  rejectedOptionsJson?: any;
  openQuestionsJson?: any;
  writebackTargetType?: string | null;
  writebackTargetRef?: string | null;
  createdById: string;
  createdByName: string;
}) {
  if (!isUuid(data.threadId)) throw new HttpError(404, 'Thread not found');
  const thread = await prisma.forumThread.findUnique({
    where: { id: data.threadId },
    select: { status: true },
  });
  if (!thread || thread.status === 'deleted') throw new HttpError(404, 'Thread not found');
  throw new HttpError(409, 'DIRECT_OUTCOME_DISABLED: authoritative outcomes may only be created by Finalization');
}

export async function findOutcomesByThreadId(threadId: string) {
  if (!isUuid(threadId)) return [];
  return prisma.forumOutcome.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findLatestOutcomeByThreadId(threadId: string) {
  if (!isUuid(threadId)) return null;
  return prisma.forumOutcome.findFirst({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
  });
}
