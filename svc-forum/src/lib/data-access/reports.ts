// reports.ts — 举报队列（moderation queue）
// 合并自 feat/report-entry-928ed7c6（原 data-access.ts Reports 段，逻辑零改动，
// 仅按 main 侧 data-access 拆分结构调整 import 路径）
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { isUuid } from '../../utils/uuid.js';
import { HttpError } from '../../utils/http-error.js';

// ── Reports (Moderation Queue) ─────────────────────────────
//
// A reporter may submit one report per target (thread|message). Duplicates are
// rejected by the @@unique([targetType, targetId, reporterId]) DB constraint
// and surfaced as 409 ALREADY_REPORTED by the route handler.

export const REPORT_REASONS = ['spam', 'abuse', 'off_topic', 'violation', 'other'] as const;
export const REPORT_STATUSES = ['pending', 'ignored', 'warned', 'deleted'] as const;
export const REPORT_TARGET_TYPES = ['thread', 'message'] as const;

export interface CreateReportInput {
  targetType: 'thread' | 'message';
  targetId: string;
  reporterId: string;
  reporterName: string;
  reason: string;
  note?: string | null;
}

/**
 * Verify the reported target exists and is not already soft-deleted.
 *
 * Hidden targets read as NOT FOUND (CTR-GOV-HIDE: indistinguishable from a
 * nonexistent id — reporting must not become a hidden-content existence
 * oracle). Deleted targets get the explicit terminal-state 400.
 */
export async function assertReportTargetExists(
  targetType: string,
  targetId: string,
): Promise<void> {
  if (!isUuid(targetId)) throw new HttpError(400, 'targetId must be a valid UUID');
  if (targetType === 'thread') {
    const thread = await prisma.forumThread.findUnique({ where: { id: targetId } });
    if (!thread || thread.status === 'hidden') throw new HttpError(404, 'Reported thread not found');
    if (thread.status === 'deleted') throw new HttpError(400, 'Cannot report a deleted thread');
    return;
  }
  if (targetType === 'message') {
    const message = await prisma.forumThreadMessage.findUnique({ where: { id: targetId } });
    if (!message) throw new HttpError(404, 'Reported message not found');
    const parent = await prisma.forumThread.findUnique({ where: { id: message.threadId } });
    if (!parent || parent.status === 'hidden') throw new HttpError(404, 'Reported message not found');
    if (message.deletedAt) throw new HttpError(400, 'Cannot report a deleted message');
    return;
  }
  throw new HttpError(400, `targetType must be one of: ${REPORT_TARGET_TYPES.join(', ')}`);
}

/**
 * Create a report. Throws HttpError 409 ALREADY_REPORTED when the same
 * reporter has already reported the same target (AC#3).
 */
export async function createReport(data: CreateReportInput) {
  if (!REPORT_REASONS.includes(data.reason as any)) {
    throw new HttpError(400, `reason must be one of: ${REPORT_REASONS.join(', ')}`);
  }
  await assertReportTargetExists(data.targetType, data.targetId);

  // AC#3: same reporter on same target counts once. Explicit pre-check keeps
  // behaviour consistent regardless of driver error mapping; the
  // @@unique([targetType, targetId, reporterId]) constraint remains as the
  // authoritative DB-level guarantee (P2002 → 409 below).
  const existing = await prisma.forumReport.findUnique({
    where: {
      targetType_targetId_reporterId: {
        targetType: data.targetType,
        targetId: data.targetId,
        reporterId: data.reporterId,
      },
    },
    select: { id: true },
  });
  if (existing) {
    throw new HttpError(409, 'ALREADY_REPORTED: this target has already been reported by you');
  }

  try {
    return await prisma.forumReport.create({
      data: {
        targetType: data.targetType,
        targetId: data.targetId,
        reporterId: data.reporterId,
        reporterName: data.reporterName,
        reason: data.reason,
        note: data.note ?? null,
        status: 'pending',
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw new HttpError(409, 'ALREADY_REPORTED: this target has already been reported by you');
    }
    throw err;
  }
}

export interface ReportFilter {
  status?: string;
  targetType?: string;
  page?: number;
  limit?: number;
}

export async function findReports(filter: ReportFilter) {
  const page = filter.page || 1;
  const limit = Math.min(filter.limit || 20, 100);
  const skip = (page - 1) * limit;

  const where: Prisma.ForumReportWhereInput = {};
  if (filter.status) where.status = filter.status;
  if (filter.targetType) where.targetType = filter.targetType;

  const [items, total] = await Promise.all([
    prisma.forumReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.forumReport.count({ where }),
  ]);

  return { items, total, page, limit };
}

export async function findReportById(id: string) {
  if (!isUuid(id)) return null;
  return prisma.forumReport.findUnique({ where: { id } });
}

export type ReportAction = 'ignore' | 'warn' | 'delete';

/** Map a moderator action to the persisted report status. */
export function reportStatusForAction(action: ReportAction): string {
  switch (action) {
    case 'ignore': return 'ignored';
    case 'warn': return 'warned';
    case 'delete': return 'deleted';
  }
}

// NOTE (DEC-GOV-003, GOVERNANCE-FINAL-AUDIT-A776CF4-R1 M-3): the unguarded
// `handleReport` data-layer helper was removed — it wrote report status AND
// soft-deleted content outside the audited governance transaction. Report
// handling exists ONLY through PATCH /api/reports/:id (applyGovernanceAction:
// audit append + report update + content cascade + reporter notice in one
// atomic boundary).
