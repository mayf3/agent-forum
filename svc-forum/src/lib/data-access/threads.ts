// threads.ts — 线程 CRUD + 上下文快照
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { isUuid } from '../../utils/uuid.js';

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
  /** 'latest' → createdAt desc; 'recently-updated' (default) → lastMessageAt desc; 'hot' → weighted heat score */
  sort?: 'latest' | 'recently-updated' | 'hot';
  /** AND semantics: thread must contain ALL of these tags (case-insensitive) */
  tagsAnd?: string[];
  /** OR semantics: thread must contain AT LEAST ONE of these tags (case-insensitive) */
  tagsOr?: string[];
}

// ── Hot ranking weights (server-side config, AC#3) ─────────────────────────
// score = viewCount*W_VIEW + messageCount*W_MSG + recencyBonus
// recencyBonus = max(0, W_RECENCY - daysSinceLastActivity * W_DECAY)
// Configurable via env: HOT_WEIGHT_VIEW / HOT_WEIGHT_MSG / HOT_WEIGHT_RECENCY / HOT_DECAY_PER_DAY
export const HOT_WEIGHT_VIEW = Number(process.env.HOT_WEIGHT_VIEW ?? 1);
export const HOT_WEIGHT_MSG = Number(process.env.HOT_WEIGHT_MSG ?? 3);
export const HOT_WEIGHT_RECENCY = Number(process.env.HOT_WEIGHT_RECENCY ?? 10);
export const HOT_DECAY_PER_DAY = Number(process.env.HOT_DECAY_PER_DAY ?? 0.5);
export const HOT_CANDIDATE_POOL = Number(process.env.HOT_CANDIDATE_POOL ?? 200);

/** Heat score for a thread (hot sort). Exported for tests. */
export function heatScore(thread: {
  viewCount?: number | null;
  messageCount?: number | null;
  lastMessageAt?: Date | null;
}): number {
  const views = thread.viewCount ?? 0;
  const msgs = thread.messageCount ?? 0;
  const lastActive = thread.lastMessageAt ?? new Date(0);
  const daysSince = Math.max(0, (Date.now() - lastActive.getTime()) / 86_400_000);
  const recency = Math.max(0, HOT_WEIGHT_RECENCY - daysSince * HOT_DECAY_PER_DAY);
  return views * HOT_WEIGHT_VIEW + msgs * HOT_WEIGHT_MSG + recency;
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
    // Default visibility: deleted (legacy soft-delete) and hidden (moderation)
    // are both removed from public listings. Governance callers can query them
    // with an explicit status filter (the route layer scope-checks that).
    where.status = { notIn: ['deleted', 'hidden'] };
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

  // 'hot' ranks by weighted heat score (viewCount/messageCount/recency) —
  // computed in the application layer over a candidate pool (AC#2).
  if (filter.sort === 'hot') {
    const candidates = await prisma.forumThread.findMany({
      where,
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      take: HOT_CANDIDATE_POOL,
    });
    const scored = candidates
      .map(t => ({ ...t, _heat: heatScore(t) }))
      .sort((a, b) => b._heat - a._heat);
    const items = scored.slice(skip, skip + limit);
    const total = await prisma.forumThread.count({ where });
    return { items, total, page, limit };
  }

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

// NOTE (DEC-GOV-003, GOVERNANCE-FINAL-AUDIT-A776CF4-R1 M-3): the unguarded
// `softDeleteThread` data-access status writer was removed. Thread soft-delete
// exists ONLY through the audited governance path — DELETE /api/threads/:id
// (applyGovernanceAction + assertLifecycleTransition) and the report-handle
// cascade inside the same audited transaction.

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
