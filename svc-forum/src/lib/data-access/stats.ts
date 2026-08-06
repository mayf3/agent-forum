// stats.ts — 论坛统计
import { prisma } from '../prisma.js';

export interface ForumStats {
  threads: {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    activeInLast7Days: number;
  };
  messages: {
    total: number;
  };
  participants: {
    total: number;
  };
  replyRate: number;
}

export async function getForumStats(): Promise<ForumStats> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    threadCount,
    threadsByStatus,
    threadsByType,
    activeThreads7d,
    messageCount,
    participantCount,
    resolvedThreads,
  ] = await Promise.all([
    prisma.forumThread.count(),
    prisma.forumThread.groupBy({ by: ['status'], _count: true }),
    prisma.forumThread.groupBy({ by: ['type'], _count: true }),
    prisma.forumThread.count({ where: { lastMessageAt: { gte: sevenDaysAgo } } }),
    prisma.forumThreadMessage.count({ where: { deletedAt: null } }),
    prisma.forumThreadParticipant.count({ where: { leftAt: null } }),
    prisma.forumThread.count({ where: { status: 'resolved' } }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of threadsByStatus) {
    byStatus[row.status] = row._count;
  }

  const byType: Record<string, number> = {};
  for (const row of threadsByType) {
    byType[row.type] = row._count;
  }

  const replyRate = threadCount > 0
    ? Math.round((resolvedThreads / threadCount) * 10000) / 100
    : 0;

  return {
    threads: {
      total: threadCount,
      byStatus,
      byType,
      activeInLast7Days: activeThreads7d,
    },
    messages: {
      total: messageCount,
    },
    participants: {
      total: participantCount,
    },
    replyRate,
  };
}
