// moderation.ts — Governance V1 治理端点（thread 生命周期 + moderator 操作）
//
// 权限：所有端点要求 forum.moderate 或 forum.admin（requireGovernanceScopes）。
// 普通 agent（只有 forum.read/write）与 requester 一律 403；request body 中
// 任何字段（包括伪造的 scope/role）都不能改变权限 —— scope 只来自已验证 JWT。
//
// 原子性：每个动作在单事务内完成 update → append audit event（唯一的
// forum_audit_events runtime writer，provenance='runtime'）→ 通知参与者；
// 审计失败 ⇒ 整个动作失败。
//
// NOTE: guards are applied PER-ROUTE, never via router.use() — this router is
// mounted under /api/threads, and a router-level use() would intercept every
// sibling sub-mount (/api/threads/:threadId/messages, /participants, ...) and
// 403 legitimate non-governance traffic that merely falls through the prefix.

import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireGovernanceScopes } from '../middleware/scope-guard.js';
import * as db from '../lib/data-access.js';
import {
  applyGovernanceAction,
  assertLifecycleTransition,
  THREAD_LIFECYCLE_ACTIONS,
  type ThreadLifecycleAction,
} from '../lib/governance.js';

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

function actorOf(req: any) {
  const user = req.user!;
  return {
    id: user.id,
    authSubject: user.authSubjectId,
    agentId: user.agentId,
    clientId: user.clientId,
    name: user.name,
    scopes: user.scopes,
  };
}

export const moderationRouter = Router();

// ── Thread lifecycle: close / archive / hide / restore ─────────────────────

function lifecycleHandler(action: ThreadLifecycleAction) {
  return asyncHandler(async (req: any, res: any) => {
    const threadId = p(req, 'threadId');
    const thread = await db.findThreadById(threadId);
    if (!thread) throw new HttpError(404, 'Thread not found');

    const user = req.user!;
    const reason: string | undefined =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim()
        : undefined;

    // hide 是从公共视野移除内容的治理动作，必须留理由。
    if (action === 'hide' && !reason) {
      throw new HttpError(400, 'reason is required to hide a thread');
    }

    const toStatus = assertLifecycleTransition(action, thread.status);

    // Single transaction: audit append → status update → participant notices.
    // Audit failure fails the whole action (no "succeeded but unrecorded").
    const { result } = await applyGovernanceAction(
      {
        actor: actorOf(req),
        eventType: `thread.${action}` as any,
        targetType: 'thread',
        targetId: threadId,
        threadId,
        revision: thread.currentRevision ?? null,
        fromStatus: thread.status,
        toStatus,
        reason: reason ?? null,
        // hide 直接影响内容可见性 → moderator_notice；其余生命周期 → thread_notice
        notifyReason: action === 'hide' ? 'moderator_notice' : 'thread_notice',
      },
      (tx) => tx.forumThread.update({ where: { id: threadId }, data: { status: toStatus } }),
    );

    res.json({ thread: result });
  });
}

for (const action of THREAD_LIFECYCLE_ACTIONS) {
  moderationRouter.post(`/:threadId/${action}`, authRequired, requireGovernanceScopes(), lifecycleHandler(action));
}

// ── Moderator operations: pin / unpin / feature / unfeature ────────────────
// 独立端点（替代 PATCH body 字段路径的治理语义），每个动作都有审计行。
// 不引入标签/分类系统 —— 只是布尔标志。

const MODERATION_FLAGS: Array<{ action: string; field: 'pinned' | 'featured'; value: boolean }> = [
  { action: 'pin', field: 'pinned', value: true },
  { action: 'unpin', field: 'pinned', value: false },
  { action: 'feature', field: 'featured', value: true },
  { action: 'unfeature', field: 'featured', value: false },
];

for (const { action, field, value } of MODERATION_FLAGS) {
  moderationRouter.post(
    `/:threadId/${action}`,
    authRequired,
    requireGovernanceScopes(),
    asyncHandler(async (req: any, res: any) => {
      const threadId = p(req, 'threadId');
      const thread = await db.findThreadById(threadId);
      if (!thread) throw new HttpError(404, 'Thread not found');

      const reason: string | null =
        typeof req.body?.reason === 'string' && req.body.reason.trim()
          ? req.body.reason.trim()
          : null;

      if (thread[field] === value) {
        throw new HttpError(400, `Thread already ${value ? '' : 'un'}${field}`);
      }

      // pin/feature 是可见性提升，不单独打扰参与者（V1 无通知），但同样
      // 在事务内 append 审计 —— 审计失败则动作失败。
      const { result } = await applyGovernanceAction(
        {
          actor: actorOf(req),
          eventType: `thread.${action}` as any,
          targetType: 'thread',
          targetId: threadId,
          threadId,
          revision: thread.currentRevision ?? null,
          reason,
        },
        (tx) => tx.forumThread.update({ where: { id: threadId }, data: { [field]: value } }),
      );

      res.json({ thread: result });
    }),
  );
}
