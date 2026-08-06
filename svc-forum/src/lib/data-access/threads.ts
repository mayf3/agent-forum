// threads.ts — 线程 CRUD + 上下文快照
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { isUuid } from '../../utils/uuid.js';
import { HttpError } from '../../utils/http-error.js';

export interface CreateThreadInput {
  title: string;
  type: string;
  contextType?: string | null;
  contextId?: string | null;
  pipeline?: string | null;
  layer?: string | null;
  tags?: string[];
  createdById: string;
  createdByName: string;
  createdByType: string;
}

export interface ThreadFilter {
  type?: string;
  status?: string;
  agentId?: string;
  contextType?: string;
  contextId?: string;
  q?: string;
  pinned?: boolean;
  featured?: boolean;
  page?: number;
  limit?: number;
  /** 'latest' → createdAt desc; 'recently-updated' (default) → lastMessageAt desc */
  sort?: 'latest' | 'recently-updated';
}

export async function createThread(data: CreateThreadInput) {
  return prisma.forumThread.create({ data });
}

export async function findThreadById(id: string) {
  if (!isUuid(id)) return null;
  return prisma.forumThread.findUnique({ where: { id } });
}

export async function findThreads(filter: ThreadFilter) {
  const page = filter.page || 1;
  const limit = Math.min(filter.limit || 20, 100);
  const skip = (page - 1) * limit;

  const where: Prisma.ForumThreadWhereInput = {};

  if (filter.type) where.type = filter.type;
  if (filter.status) {
    where.status = filter.status;
  } else {
    where.status = { not: 'deleted' };
  }
  if (filter.contextType) where.contextType = filter.contextType;
  if (filter.contextId) where.contextId = filter.contextId;
  if (filter.pinned !== undefined) where.pinned = filter.pinned;
  if (filter.featured !== undefined) where.featured = filter.featured;

  if (filter.agentId) {
    where.participants = { some: { agentId: filter.agentId } };
  }

  if (filter.q) {
    where.OR = [
      { title: { contains: filter.q, mode: 'insensitive' } },
    ];
  }

  const baseOrderBy: Prisma.ForumThreadOrderByWithRelationInput =
    filter.sort === 'latest'
      ? { createdAt: 'desc' }
      : { lastMessageAt: { sort: 'desc', nulls: 'last' } };

  const orderBy: Prisma.ForumThreadOrderByWithRelationInput[] = [
    { pinned: 'desc' },
    baseOrderBy,
  ];

  const [items, total] = await Promise.all([
    prisma.forumThread.findMany({
      where,
      orderBy,
      skip,
      take: limit,
    }),
    prisma.forumThread.count({ where }),
  ]);

  return { items, total, page, limit };
}

export async function updateThread(id: string, data: Prisma.ForumThreadUpdateInput) {
  if (!isUuid(id)) throw new Error('Invalid thread id format');
  return prisma.forumThread.update({ where: { id }, data });
}

export async function softDeleteThread(id: string) {
  if (!isUuid(id)) throw new HttpError(404, 'Thread not found');
  return prisma.forumThread.update({
    where: { id },
    data: { status: 'deleted' },
  });
}

// ── Context Snapshots ──────────────────────────────────────

export async function createContextSnapshot(data: {
  threadId: string;
  snapshotType: string;
  sourceType: string;
  sourceRef: string;
  title: string;
  excerptMd?: string | null;
  contentHash?: string | null;
  snapshot?: any;
  takenById: string;
  takenByName: string;
  note?: string | null;
}) {
  return prisma.forumContextSnapshot.create({ data });
}

export async function findSnapshotsByThreadId(threadId: string) {
  if (!isUuid(threadId)) return [];
  return prisma.forumContextSnapshot.findMany({
    where: { threadId },
    orderBy: { takenAt: 'desc' },
  });
}
