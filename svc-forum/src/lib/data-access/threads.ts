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
  /** AND semantics: thread must contain ALL of these tags (case-insensitive) */
  tagsAnd?: string[];
  /** OR semantics: thread must contain AT LEAST ONE of these tags (case-insensitive) */
  tagsOr?: string[];
}

export async function createThread(data: CreateThreadInput) {
  // Normalize tags toLowerCase so tag filtering (case-insensitive, hasEvery/hasSome)
  // works on the stored values.
  const normalized = {
    ...data,
    tags: (data.tags || []).map((t: string) => t.trim().toLowerCase()).filter(Boolean),
  };
  return prisma.forumThread.create({ data: normalized });
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

  // Tag filtering (AC: tag=<name> with multi-tag AND/OR combos, case-insensitive).
  // PostgreSQL text[] has no native case-insensitive contains, so we match against
  // lowercased tag names. Stored tags are normalized toLowerCase on create/update,
  // so hasEvery/hasSome on the lowercased query values is correct.
  const tagsAnd = (filter.tagsAnd || []).map(t => t.toLowerCase()).filter(Boolean);
  const tagsOr = (filter.tagsOr || []).map(t => t.toLowerCase()).filter(Boolean);
  if (tagsAnd.length > 0 || tagsOr.length > 0) {
    where.tags = {};
    if (tagsAnd.length > 0) where.tags.hasEvery = tagsAnd;
    if (tagsOr.length > 0) where.tags.hasSome = tagsOr;
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
  const normalized = { ...data };
  if (Array.isArray(normalized.tags)) {
    normalized.tags = (normalized.tags as string[])
      .map((t: string) => t.trim().toLowerCase())
      .filter(Boolean);
  }
  return prisma.forumThread.update({ where: { id }, data: normalized });
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
