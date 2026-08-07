import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireWriteScope, requireReadScope, requireModeratorScope } from '../middleware/scope-guard.js';
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
reportsRouter.get('/', requireModeratorScope(), asyncHandler(async (req, res) => {
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

// PATCH /api/reports/:id — handle report (moderator only)
// action = ignore | warn | delete; delete soft-deletes the reported content.
reportsRouter.patch('/:id', requireModeratorScope(), requireWriteScope(), asyncHandler(async (req, res) => {
  const { action, note } = req.body;
  if (!action || !['ignore', 'warn', 'delete'].includes(action)) {
    throw new HttpError(400, 'action must be one of: ignore, warn, delete');
  }

  const user = req.user!;
  const report = await db.handleReport(
    p(req, 'id'),
    action,
    user.id,
    user.name,
    note || null,
  );

  res.json({ report });
}));
