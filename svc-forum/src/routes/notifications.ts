// notifications.ts — Governance V1 物化通知 API（/api/notifications）
//
// 通知可查询、已读状态可更新。收件人永远取自已验证身份（req.user.id =
// 本地 ForumPrincipal id），不接受 body/query 指定收件人 —— 一个 Agent 不能
// 读/标记别人的通知。不做实时推送；后续接 Feishu 的外部 puller 直接消费
// 本 API 或 forum_notification_facts 表（unread = read_at IS NULL）。

import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireReadScope, requireWriteScope } from '../middleware/scope-guard.js';
import {
  NOTIFICATION_REASONS,
  findNotificationsForPrincipal,
  markNotificationFactRead,
  markNotificationFactsRead,
} from '../lib/data-access/notification-store.js';

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

export const notificationsRouter = Router();

notificationsRouter.use(authRequired);

// GET /api/notifications — my materialized notifications
//   ?type=mention|thread_notice|moderator_notice  (optional filter)
//   ?unread=true                                   (unread only)
//   ?threadId=<uuid>                               (optional thread filter)
//   ?page=N&limit=N
notificationsRouter.get('/', requireReadScope(), asyncHandler(async (req, res) => {
  const user = req.user!;
  const { type, unread, threadId, page, limit } = req.query as Record<string, string | undefined>;

  if (type !== undefined && !NOTIFICATION_REASONS.includes(type as any)) {
    throw new HttpError(400, `type must be one of: ${NOTIFICATION_REASONS.join(', ')}`);
  }
  if (unread !== undefined && unread !== 'true' && unread !== 'false') {
    throw new HttpError(400, 'unread must be "true" or "false"');
  }

  const result = await findNotificationsForPrincipal(user.id, {
    reason: type as any,
    unreadOnly: unread === 'true',
    threadId: threadId || undefined,
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 20,
  });

  res.json(result);
}));

// POST /api/notifications/:id/read — mark one notification read (own only)
notificationsRouter.post('/:id/read', requireWriteScope(), asyncHandler(async (req, res) => {
  const user = req.user!;

  const notification = await markNotificationFactRead(p(req, 'id'), user.id);
  if (!notification) throw new HttpError(404, 'Notification not found');

  res.json({ notification });
}));

// POST /api/notifications/read — batch mark read
//   body: { ids: string[] }   (max 100; foreign/unknown ids are ignored)
notificationsRouter.post('/read', requireWriteScope(), asyncHandler(async (req, res) => {
  const user = req.user!;

  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new HttpError(400, 'ids must be a non-empty array');
  }
  if (ids.length > 100) {
    throw new HttpError(400, 'ids must not exceed 100 items per batch');
  }
  if (ids.some((id: unknown) => typeof id !== 'string')) {
    throw new HttpError(400, 'ids must be strings');
  }

  const result = await markNotificationFactsRead(ids, user.id);
  res.json(result);
}));
