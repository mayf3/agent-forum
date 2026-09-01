import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireWriteScope, requireReadScope, requireGovernanceScopes } from '../middleware/scope-guard.js';
import { getPrisma } from '../lib/prisma.js';
import { applyGovernanceAction, assertLifecycleTransition } from '../lib/governance.js';
import { createNotificationFacts } from '../lib/data-access/notification-store.js';
import { repairThreadMessageDerivedState } from '../lib/data-access/messages.js';
import * as db from '../lib/data-access.js';

export const reportsRouter = Router();

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

reportsRouter.use(authRequired);

// POST /api/reports — submit a report (thread|message target, reason required)
reportsRouter.post('/', requireWriteScope(), asyncHandler(async (req, res) => {
  const { targetType, targetId, reason, note } = req.body;

  if (!targetType || !targetId) {
    throw new HttpError(400, 'targetType and targetId are required');
  }
  if (!reason || !reason.trim()) {
    throw new HttpError(400, 'reason is required');
  }

  const user = req.user!;
  const report = await db.createReport({
    targetType,
    targetId,
    reporterId: user.id,
    reporterName: user.name,
    reason: reason.trim(),
    note: note || null,
  });

  res.status(201).json({ report });
}));

// GET /api/reports — moderator queue (status/targetType filter + pagination)
// Moderator scope implies read access to the moderation queue (ARCH_DESIGN).
reportsRouter.get('/', requireGovernanceScopes(), asyncHandler(async (req, res) => {
  const { status, targetType, page, limit } = req.query as Record<string, string | undefined>;

  if (status !== undefined && !db.REPORT_STATUSES.includes(status as any)) {
    throw new HttpError(400, `status must be one of: ${db.REPORT_STATUSES.join(', ')}`);
  }
  if (targetType !== undefined && !db.REPORT_TARGET_TYPES.includes(targetType as any)) {
    throw new HttpError(400, `targetType must be one of: ${db.REPORT_TARGET_TYPES.join(', ')}`);
  }

  const result = await db.findReports({
    status: status || undefined,
    targetType: targetType || undefined,
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 20,
  });

  res.json(result);
}));

// GET /api/reports/:id — query report status (any authenticated reader)
reportsRouter.get('/:id', requireReadScope(), asyncHandler(async (req, res) => {
  const report = await db.findReportById(p(req, 'id'));
  if (!report) throw new HttpError(404, 'Report not found');
  res.json({ report });
}));

// PATCH /api/reports/:id — handle report (moderator/admin)
// action = ignore | warn | delete; delete soft-deletes the reported content.
// Governance V1: ONE transaction — report update + audit event append +
// reporter notification. If the audit append fails, the handling rolls back.
reportsRouter.patch('/:id', requireGovernanceScopes(), requireWriteScope(), asyncHandler(async (req, res) => {
  const { action, note } = req.body;
  if (!action || !['ignore', 'warn', 'delete'].includes(action)) {
    throw new HttpError(400, 'action must be one of: ignore, warn, delete');
  }

  // The `delete` action cascades into content soft-deletion (thread tombstone
  // / message tombstone + derived repair). Deletion requires a non-empty
  // moderation reason (CTR-DELETE-001/002) — the existing `note` field IS the
  // handling reason (persisted as handleNote and audit payload.reason), so
  // reuse it rather than adding a second field. Missing / non-string / empty /
  // whitespace-only on a deleting action → 400.
  const moderationReason: string | null =
    typeof note === 'string' && note.trim() ? note.trim() : null;
  if (action === 'delete' && !moderationReason) {
    throw new HttpError(400, 'reason (note) is required to delete reported content');
  }

  const user = req.user!;
  const reportId = p(req, 'id');
  const report = await db.findReportById(reportId);
  if (!report) throw new HttpError(404, 'Report not found');
  if (report.status !== 'pending') {
    throw new HttpError(409, `Report already handled (status=${report.status})`);
  }

  const prisma = getPrisma();
  const { result } = await applyGovernanceAction(
    {
      actor: {
        id: user.id,
        authSubject: user.authSubjectId,
        agentId: user.agentId,
        clientId: user.clientId,
        name: user.name,
        scopes: user.scopes,
      },
      eventType: 'report.handle',
      targetType: 'report',
      targetId: reportId,
      threadId: report.targetType === 'thread' ? report.targetId : null,
      fromStatus: 'pending',
      toStatus: db.reportStatusForAction(action),
      // The moderation reason flows into this audit event — the SAME event
      // that covers the cascaded message/thread soft-delete below.
      reason: moderationReason,
      metadata: {
        reportAction: action,
        reportedTargetType: report.targetType,
        reportedTargetId: report.targetId,
      },
    },
    async (tx, audit) => {
      const now = new Date();
      const toStatus = db.reportStatusForAction(action);

      // delete action cascades: soft-delete the reported content (same tx),
      // through the SAME unified guards the direct endpoints use.
      if (action === 'delete') {
        if (report.targetType === 'thread') {
          const targetThread = await tx.forumThread.findUnique({
            where: { id: report.targetId },
            select: { status: true },
          });
          // deleted is terminal — a second delete through a report is a
          // conflict, and the state machine keeps this the only status path.
          if (targetThread) {
            assertLifecycleTransition('softDelete', targetThread.status);
          }
          await tx.forumThread.update({
            where: { id: report.targetId },
            data: { status: 'deleted' },
          });
        } else {
          await tx.forumThreadMessage.update({
            where: { id: report.targetId },
            data: { deletedAt: now },
          });
          // CTR-DELETE-002: repair derived thread state in the same tx.
          const parent = await tx.forumThreadMessage.findUnique({
            where: { id: report.targetId },
            select: { threadId: true },
          });
          if (parent) {
            await repairThreadMessageDerivedState(tx, parent.threadId);
          }
        }
      }

      const updated = await tx.forumReport.update({
        where: { id: reportId },
        data: {
          status: toStatus,
          handledById: user.id,
          handledByName: user.name,
          handledAt: now,
          handleNote: note || null,
        },
      });

      // Reporter notice (moderator_notice), keyed on the audit event —
      // same transaction, idempotent.
      if (report.reporterId !== user.id) {
        const threadId =
          report.targetType === 'thread'
            ? report.targetId
            : (
                await tx.forumThreadMessage.findUnique({
                  where: { id: report.targetId },
                  select: { threadId: true },
                })
              )?.threadId;
        if (threadId) {
          await createNotificationFacts(
            [
              {
                recipientPrincipalId: report.reporterId,
                threadId,
                messageId: report.targetType === 'message' ? report.targetId : null,
                reason: 'moderator_notice',
                sourceEventKey: `audit:${audit.eventId}`,
                payload: {
                  action: 'report.handle',
                  reportAction: action,
                  reportStatus: toStatus,
                },
              },
            ],
            tx,
          );
        }
      }

      return updated;
    },
  );

  res.json({ report: result });
}));
