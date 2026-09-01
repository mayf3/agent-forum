// notification-store.ts — Governance V1 materialized notifications.
//
// SINGLE notification model: forum_notification_facts (subscription-storage
// fact table; this is its first runtime writer). Recipients are local
// ForumPrincipal ids — resolved from the authenticated caller, never accepted
// from request input, so an agent cannot read or mark another agent's rows.
//
// reason (notification type): mention | thread_notice | moderator_notice
//   (the DB CHECK was widened by the governance_v1 migration; watch/reaction
//    remain reserved for the derived subscription flows)
// sourceEventKey: idempotency key unique per recipient —
//   mention → `mention:<messageId>`, governance → `audit:<auditEventId>`,
//   report  → `report:<reportId>`
// payload: bounded context (action/from→to/reason) reserved for external
//   delivery bridging (e.g. Feishu) — unread = readAt IS NULL.

import { prisma } from '../prisma.js';

export const NOTIFICATION_REASONS = [
  'mention',
  'thread_notice',
  'moderator_notice',
] as const;
export type NotificationReason = (typeof NOTIFICATION_REASONS)[number];

export interface CreateNotificationFactInput {
  recipientPrincipalId: string;
  threadId: string;
  messageId?: string | null;
  reason: NotificationReason;
  sourceEventKey: string;
  payload?: Record<string, unknown> | null;
}

/** Allowlisted client for transactional fan-out (prisma or tx client). */
export type NotificationFactWriter = any;

/**
 * Create notification facts (idempotent per (recipient, sourceEventKey)).
 * Accepts a transaction client so governance fan-out is atomic with the
 * audited entity change; also used outside transactions for mentions.
 */
export async function createNotificationFacts(
  inputs: CreateNotificationFactInput[],
  client: NotificationFactWriter = prisma,
) {
  if (inputs.length === 0) return { count: 0 };

  // Dedup within the batch (the DB unique constraint covers cross-batch).
  const seen = new Set<string>();
  const unique = inputs.filter((n) => {
    const key = `${n.recipientPrincipalId}|${n.sourceEventKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return client.forumNotificationFact.createMany({
    data: unique.map((n) => ({
      recipientPrincipalId: n.recipientPrincipalId,
      threadId: n.threadId,
      messageId: n.messageId ?? null,
      reactionId: null,
      reason: n.reason,
      sourceEventKey: n.sourceEventKey,
      // createdAt has no @default in the subscription-storage schema — the
      // runtime writer supplies it explicitly.
      createdAt: new Date(),
      payload: (n.payload ?? undefined) as any,
    })),
    skipDuplicates: true,
  });
}

// ── Query side (GET /api/notifications) ────────────────────────────────────

export interface NotificationFactFilter {
  reason?: NotificationReason;
  unreadOnly?: boolean;
  threadId?: string;
  page?: number;
  limit?: number;
}

export interface NotificationFactView {
  id: string;
  recipientPrincipalId: string;
  threadId: string;
  messageId: string | null;
  type: string;
  payload: any;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationFactsResult {
  items: NotificationFactView[];
  total: number;
  page: number;
  limit: number;
  unreadCount: number;
}

export async function findNotificationsForPrincipal(
  recipientPrincipalId: string,
  filter: NotificationFactFilter = {},
): Promise<NotificationFactsResult> {
  const page = filter.page || 1;
  const limit = Math.min(filter.limit || 20, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { recipientPrincipalId };
  if (filter.reason) where.reason = filter.reason;
  if (filter.unreadOnly) where.readAt = null;
  if (filter.threadId) where.threadId = filter.threadId;

  const unreadWhere: Record<string, unknown> = { recipientPrincipalId, readAt: null };
  if (filter.reason) unreadWhere.reason = filter.reason;

  const [rows, total, unreadCount] = await Promise.all([
    prisma.forumNotificationFact.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.forumNotificationFact.count({ where }),
    prisma.forumNotificationFact.count({ where: unreadWhere }),
  ]);

  const items: NotificationFactView[] = rows.map((r: any) => ({
    id: r.id,
    recipientPrincipalId: r.recipientPrincipalId,
    threadId: r.threadId,
    messageId: r.messageId,
    type: r.reason,
    payload: r.payload ?? null,
    readAt: r.readAt ?? null,
    createdAt: r.createdAt,
  }));

  return { items, total, page, limit, unreadCount };
}

/**
 * Mark one notification read. Scoped to the recipient: a mismatched caller
 * gets null (indistinguishable from "does not exist" — no existence leak).
 */
export async function markNotificationFactRead(id: string, recipientPrincipalId: string) {
  const existing = await prisma.forumNotificationFact.findUnique({ where: { id } });
  if (!existing || existing.recipientPrincipalId !== recipientPrincipalId) return null;
  if (existing.readAt) return existing;
  return prisma.forumNotificationFact.update({
    where: { id },
    data: { readAt: new Date() },
  });
}

/**
 * Batch mark notifications read (max 100 ids). Only the caller's own rows are
 * touched; unknown/foreign ids are silently ignored (idempotent semantics).
 * Returns { updated } — rows this call actually flipped.
 */
export async function markNotificationFactsRead(ids: string[], recipientPrincipalId: string) {
  if (ids.length === 0) return { updated: 0 };
  const result = await prisma.forumNotificationFact.updateMany({
    where: { id: { in: ids }, recipientPrincipalId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}
