// outcomes.ts — 结论管理
import { prisma } from '../prisma.js';
import { isUuid } from '../../utils/uuid.js';

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
  return prisma.forumOutcome.create({ data });
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
