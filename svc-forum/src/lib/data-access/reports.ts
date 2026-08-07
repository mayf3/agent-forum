// reports.ts — 举报队列（moderation queue）
// 合并自 feat/report-entry-928ed7c6（原 data-access.ts Reports 段，逻辑零改动，
// 仅按 main 侧 data-access 拆分结构调整 import 路径）
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { isUuid } from '../../utils/uuid.js';
import { HttpError } from '../../utils/http-error.js';
import { softDeleteThread } from './threads.js';
import { softDeleteMessage } from './messages.js';

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

/** Verify the reported target exists and is not already soft-deleted. */
export async function assertReportTargetExists(
  targetType: string,
  targetId: string,
): Promise<void> {
  if (!isUuid(targetId)) throw new HttpError(400, 'targetId must be a valid UUID');
  if (targetType === 'thread') {
    const thread = await prisma.forumThread.findUnique({ where: { id: targetId } });
    if (!thread) throw new HttpError(404, 'Reported thread not found');
    if (thread.status === 'deleted') throw new HttpError(400, 'Cannot report a deleted thread');
    return;
  }
  if (targetType === 'message') {
    const message = await prisma.forumThreadMessage.findUnique({ where: { id: targetId } });
    if (!message) throw new HttpError(404, 'Reported message not found');
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

/**
 * Handle a report (moderator only, enforced by the route scope guard).
 *   ignore -> status=ignored
 *   warn   -> status=warned
 *   delete -> status=deleted AND soft-delete the reported target
 * Every action leaves a trace: handledBy / handledAt / handleNote + status (AC#4).
 */
export async function handleReport(
  id: string,
  action: ReportAction,
  handledById: string,
  handledByName: string,
  handleNote?: string | null,
) {
  const report = await findReportById(id);
  if (!report) throw new HttpError(404, 'Report not found');
  if (report.status !== 'pending') {
    throw new HttpError(409, `Report already handled (status=${report.status})`);
  }

  const now = new Date();
  const updateData: Prisma.ForumReportUpdateInput = {
    status: reportStatusForAction(action),
    handledById,
    handledByName,
    handledAt: now,
    handleNote: handleNote || null,
  };

  // AC#4 delete action cascades: soft-delete the reported content so it is no
  // longer visible, while the report record keeps the trace.
  if (action === 'delete') {
    if (report.targetType === 'thread') {
      await softDeleteThread(report.targetId);
    } else {
      await softDeleteMessage(report.targetId);
    }
  }

  return prisma.forumReport.update({ where: { id }, data: updateData });
}
