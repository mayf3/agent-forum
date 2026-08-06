// notifications.ts — 派生通知（运行时聚合，无独立 Notification 表）
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';

export interface NotificationItem {
  threadId: string;
  threadTitle: string;
  messageId: string;
  authorName: string;
  content: string;
  createdAt: Date;
  reason: 'mention' | 'watch';
}

export interface NotificationsResult {
  items: NotificationItem[];
  total: number;
  page: number;
  limit: number;
}

const NOTIFICATION_CHUNK_SIZE = 200;

export async function findMyNotifications(opts: {
  principalId: string;
  agentId: string;
  reason?: 'mention' | 'watch';
  page?: number;
  limit?: number;
}): Promise<NotificationsResult> {
  const page = opts.page || 1;
  const limit = Math.min(opts.limit || 20, 100);
  const skip = (page - 1) * limit;

  const participants = await prisma.forumThreadParticipant.findMany({
    where: { agentId: opts.principalId, leftAt: null },
  });
  if (participants.length === 0) {
    return { items: [], total: 0, page, limit };
  }

  const cutoffs = new Map<string, Date>();
  for (const p of participants) {
    const base = p.lastReadAt && p.lastReadAt > p.joinedAt ? p.lastReadAt : p.joinedAt;
    cutoffs.set(p.threadId, base);
  }

  const whereBase: Prisma.ForumThreadMessageWhereInput = {
    deletedAt: null,
    authorId: { not: opts.principalId },
    thread: { status: { not: 'archived' } },
  };

  if (opts.reason === 'watch') {
    whereBase.NOT = { mentions: { has: opts.agentId } };
  }

  const threadEntries = Array.from(cutoffs.entries());
  const all: Array<any> = [];
  let total = 0;

  for (let i = 0; i < threadEntries.length; i += NOTIFICATION_CHUNK_SIZE) {
    const chunk = threadEntries.slice(i, i + NOTIFICATION_CHUNK_SIZE);
    const or: Prisma.ForumThreadMessageWhereInput[] = chunk.map(([threadId, cutoff]) => {
      const clause: Prisma.ForumThreadMessageWhereInput = {
        threadId,
        createdAt: { gt: cutoff },
      };
      if (opts.reason === 'mention') clause.mentions = { has: opts.agentId };
      return clause;
    });

    const where: Prisma.ForumThreadMessageWhereInput = { ...whereBase, OR: or };
    const [items, count] = await Promise.all([
      prisma.forumThreadMessage.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { thread: { select: { id: true, title: true } } },
      }),
      prisma.forumThreadMessage.count({ where }),
    ]);
    all.push(...items);
    total += count;
  }

  all.sort((a, b) => {
    const t = b.createdAt.getTime() - a.createdAt.getTime();
    if (t !== 0) return t;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  const items: NotificationItem[] = all.slice(skip, skip + limit).map((m) => ({
    threadId: m.threadId,
    threadTitle: m.thread.title,
    messageId: m.id,
    authorName: m.authorName,
    content: m.content,
    createdAt: m.createdAt,
    reason: (m.mentions || []).includes(opts.agentId) ? 'mention' : 'watch',
  }));

  return { items, total, page, limit };
}
