// search.ts — 全文搜索
import { prisma } from '../prisma.js';

export async function searchAll(q: string) {
  const threads = await prisma.forumThread.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    take: 20,
  });

  const messages = await prisma.forumThreadMessage.findMany({
    where: {
      deletedAt: null,
      content: { contains: q, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      thread: { select: { id: true, title: true } },
    },
  });

  const outcomes = await prisma.forumOutcome.findMany({
    where: {
      summaryMd: { contains: q, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      thread: { select: { id: true, title: true } },
    },
  });

  return { threads, messages, outcomes };
}
