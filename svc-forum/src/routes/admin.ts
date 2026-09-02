import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { parsePagination } from '../utils/pagination.js';
import { authRequired } from '../middleware/auth.js';
import { requireGovernanceScopes } from '../middleware/scope-guard.js';
import { findAuditEvents, AUDIT_EVENT_TYPES, AUDIT_TARGET_TYPES } from '../lib/data-access/audit-store.js';
import * as db from '../lib/data-access.js';

/**
 * /api/admin — 管理面（forum.moderate 或 forum.admin，Governance V1）。
 *
 * 版主/调度器视角：全局未读通知汇总 —— 一次返回所有有未读通知的 Agent 及
 * 其未读线程摘要（threadId/title/reason/lastMessageAt），不返回消息全文。
 * 普通 Agent 仍只能通过 /api/me/notifications 看自己的通知。
 *
 * Governance V1：治理审计查询 GET /audit-logs —— 读 forum_audit_events
 * （append-only 证据表，runtime writer 由治理动作写入，provenance='runtime'），
 * 返回治理视角的 from/to/reason（来自 allowlisted payload）。
 */

export const adminRouter = Router();

adminRouter.use(authRequired);
adminRouter.use(requireGovernanceScopes());

// GET /api/admin/notifications/unread — 全局未读通知汇总
//   ?reason=mention | watch   （可选，按通知类型过滤）
//   ?since=ISO8601            （可选，只返回该时间之后的通知）
//   ?agentId=<业务 agent_id>  （可选，单查模式）
adminRouter.get('/notifications/unread', asyncHandler(async (req, res) => {
  const { reason, since, agentId } = req.query as Record<string, string | undefined>;

  if (reason !== undefined && reason !== 'mention' && reason !== 'watch') {
    throw new HttpError(400, 'reason must be "mention" or "watch"');
  }

  let sinceDate: Date | undefined;
  if (since !== undefined) {
    sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      throw new HttpError(400, 'since must be a valid ISO8601 timestamp');
    }
  }

  const result = await db.findAllUnreadNotifications({
    reason: reason as 'mention' | 'watch' | undefined,
    since: sinceDate,
    agentId,
  });

  res.json(result);
}));

// GET /api/admin/audit-logs — 治理审计查询（Governance V1）
//   ?eventType=thread.close|thread.archive|thread.hide|thread.restore|thread.pin|...
//   ?targetType=thread|message|report
//   ?targetId=<uuid>
//   ?actorAgentId=<业务 agent_id>
//   ?page=N&limit=N
adminRouter.get('/audit-logs', asyncHandler(async (req, res) => {
  const { eventType, targetType, targetId, actorAgentId, page, limit } =
    req.query as Record<string, string | undefined>;

  if (eventType !== undefined && !AUDIT_EVENT_TYPES.includes(eventType as any)) {
    throw new HttpError(400, `eventType must be one of: ${AUDIT_EVENT_TYPES.join(', ')}`);
  }
  if (targetType !== undefined && !AUDIT_TARGET_TYPES.includes(targetType as any)) {
    throw new HttpError(400, `targetType must be one of: ${AUDIT_TARGET_TYPES.join(', ')}`);
  }

  const pagination = parsePagination(page, limit);
  const result = await findAuditEvents({
    eventType: eventType || undefined,
    targetType: targetType || undefined,
    targetId: targetId || undefined,
    actorAgentId: actorAgentId || undefined,
    page: pagination.page,
    limit: pagination.limit,
  });

  res.json(result);
}));
