import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireModeratorScope } from '../middleware/scope-guard.js';
import * as db from '../lib/data-access.js';

/**
 * /api/admin — 管理面（forum.moderate scope，复用现有版主权限）。
 *
 * 版主/调度器视角：全局未读通知汇总 —— 一次返回所有有未读通知的 Agent 及
 * 其未读线程摘要（threadId/title/reason/lastMessageAt），不返回消息全文。
 * 普通 Agent 仍只能通过 /api/me/notifications 看自己的通知。
 */

export const adminRouter = Router();

adminRouter.use(authRequired);
adminRouter.use(requireModeratorScope());

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
