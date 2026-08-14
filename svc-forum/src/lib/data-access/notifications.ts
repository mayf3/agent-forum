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
  reason: 'mention' | 'watch' | 'reaction';
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
  reason?: 'mention' | 'watch' | 'reaction';
  page?: number;
  limit?: number;
}): Promise<NotificationsResult> {
  const page = opts.page || 1;
  const limit = Math.min(opts.limit || 20, 100);
  const skip = (page - 1) * limit;

  // ── Reaction notifications (AC#3: 被赞者收到 my-updates) ─────────────
  // Derived at query time: messages authored by me that received reactions
  // after my per-thread unread baseline. No notification table — consistent
  // with the existing mention/watch derivation.
  if (opts.reason === 'reaction') {
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
    const threadEntries = Array.from(cutoffs.entries());
    const all: Array<any> = [];
    let total = 0;
    for (let i = 0; i < threadEntries.length; i += NOTIFICATION_CHUNK_SIZE) {
      const chunk = threadEntries.slice(i, i + NOTIFICATION_CHUNK_SIZE);
      const or: Prisma.ForumThreadMessageWhereInput[] = chunk.map(([threadId, cutoff]) => ({
        threadId,
        authorId: opts.principalId,
        reactions: { some: { createdAt: { gt: cutoff } } },
      }));
      const where: Prisma.ForumThreadMessageWhereInput = {
        deletedAt: null,
        thread: { status: { not: 'archived' } },
        OR: or,
      };
      const [items, count] = await Promise.all([
        prisma.forumThreadMessage.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: {
            thread: { select: { id: true, title: true } },
            reactions: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
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
      authorName: m.reactions?.[0]?.principalName || m.authorName,
      content: m.content,
      createdAt: m.reactions?.[0]?.createdAt || m.createdAt,
      reason: 'reaction',
    }));
    return { items, total, page, limit };
  }

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

// ─── Admin: 全局未读通知汇总（版主/调度器视角）────────────────────────────
//
// V1 刻意极简：不重算 mention/watch 语义、不做跨 agent batch 查询 —— 循环复用
// findMyNotifications（分页取全），只按 threadId 聚合成版主视角的摘要。每 agent
// 的内部查询数 = ceil(unread/100) + 1，几十个 Agent 规模完全可接受；将来若需
// 优化为 batch 查询，API 契约保持不变。

export interface AdminUnreadThread {
  threadId: string;
  title: string;
  reason: 'mention' | 'watch';
  lastMessageAt: Date;
  unread: true;
}

export interface AdminUnreadAgent {
  agentId: string;      // 业务 agent_id（forum_principals.agent_id）
  agentName: string;
  unreadCount: number;  // 有未读的线程数（= threads.length）
  threads: AdminUnreadThread[];
}

export interface AdminUnreadResult {
  total: number;
  items: AdminUnreadAgent[];
}

const ADMIN_PAGE_LIMIT = 100;

export async function findAllUnreadNotifications(opts: {
  reason?: 'mention' | 'watch';
  since?: Date;
  agentId?: string; // 业务 agent_id —— 单查模式
}): Promise<AdminUnreadResult> {
  // 1. Forum-visible agent 目录 = forum_principals（JIT 创建，不依赖 Auth）
  const principals = await prisma.forumPrincipal.findMany({
    where: {
      principalType: 'agent',
      status: 'active',
      agentId: { not: null },
      ...(opts.agentId ? { agentId: opts.agentId } : {}),
    },
    orderBy: { agentId: 'asc' },
  });
  if (principals.length === 0) {
    return { total: 0, items: [] };
  }

  const items: AdminUnreadAgent[] = [];

  for (const p of principals) {
    const businessAgentId = p.agentId as string;

    // 2. 复用个人通知逻辑并分页取全（不截断）
    const all: NotificationItem[] = [];
    let page = 1;
    for (;;) {
      const res = await findMyNotifications({
        principalId: p.id,
        agentId: businessAgentId,
        reason: opts.reason,
        page,
        limit: ADMIN_PAGE_LIMIT,
      });
      all.push(...res.items);
      if (all.length >= res.total) break;
      page += 1;
    }
    if (all.length === 0) continue;

    // 3. since 过滤（JS 层，保持与分页取全解耦）
    const since = opts.since;
    const filtered = since ? all.filter((n) => n.createdAt > since) : all;
    if (filtered.length === 0) continue;

    // 4. 按线程聚合：mention 优先，lastMessageAt = 最新未读消息
    const threadMap = new Map<string, AdminUnreadThread>();
    for (const n of filtered) {
      const t = threadMap.get(n.threadId);
      if (!t) {
        threadMap.set(n.threadId, {
          threadId: n.threadId,
          title: n.threadTitle,
          reason: n.reason === 'mention' ? 'mention' : 'watch',
          lastMessageAt: n.createdAt,
          unread: true,
        });
      } else {
        if (n.reason === 'mention') t.reason = 'mention';
        if (n.createdAt > t.lastMessageAt) t.lastMessageAt = n.createdAt;
      }
    }
    const threadList = [...threadMap.values()].sort(
      (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
    );

    items.push({
      agentId: businessAgentId,
      agentName: p.displayName ?? businessAgentId,
      unreadCount: threadList.length,
      threads: threadList,
    });
  }

  // 5. Agent 按最近未读活动倒序
  items.sort((a, b) => {
    const la = a.threads[0]?.lastMessageAt.getTime() ?? 0;
    const lb = b.threads[0]?.lastMessageAt.getTime() ?? 0;
    return lb - la;
  });

  return { total: items.length, items };
}
