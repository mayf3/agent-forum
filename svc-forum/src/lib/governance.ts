// governance.ts — Governance V1 核心规则与事务编排
//
// 1) Thread 状态机（统一守卫）：open/closed/resolved/archived/hidden/deleted
//    的每一次 status 变更都必须经过 assertLifecycleTransition —— 不存在
//    绕过该表直接写 status 的第二条路径。
// 2) 治理动作原子性：同一事务内
//       update entity → append audit event → create notifications
//    audit append 失败 ⇒ 整个治理动作回滚失败 —— 不允许"成功但无记录"。
//    通知 fan-out 也在同事务内（同一 sourceEventKey 幂等，事务重试安全）。
// 3) 普通读取可见性（hidden/deleted）：assertOrdinaryReadVisibility 是所有
//    读取面共用的守卫 —— 普通调用者得到与"不存在"不可区分的 404，
//    moderator/admin 按治理权限保留读取。
//
// 审计单一模型：forum_audit_events（append-only，provenance='runtime'）。
// 通知单一模型：forum_notification_facts（sourceEventKey = audit eventId）。

import { getPrisma } from './prisma.js';
import { HttpError } from '../utils/http-error.js';
import { withTransactionRetry } from './data-access/shared.js';
import {
  appendAuditEvent,
  type AuditActor,
  type AuditEventType,
  type AuditTargetType,
} from './data-access/audit-store.js';
import {
  createNotificationFacts,
  type NotificationReason,
} from './data-access/notification-store.js';

// ── Thread lifecycle state machine ──────────────────────────────────────────

export const THREAD_LIFECYCLE_ACTIONS = ['close', 'archive', 'hide', 'restore'] as const;
export type ThreadLifecycleAction = (typeof THREAD_LIFECYCLE_ACTIONS)[number];

/** Every status-mutating action, including the two non-moderation ones. */
export type ThreadStatusAction = ThreadLifecycleAction | 'resolve' | 'softDelete';

/**
 * Minimal V1 mapping onto the single legacy `forum_threads.status` column
 * (the orthogonal discussion/visibility model lands with the lifecycle
 * storage cutover — this table must not grow ad-hoc members):
 *
 *   open      discussion open
 *   closed    closed by governance (no new messages)
 *   resolved  finalized discussion (legacy finalization semantics)
 *   archived  archived visibility (read-only)
 *   hidden    moderation visibility overlay (single-column mapping)
 *   deleted   terminal tombstone (CTR-LIFE-005)
 *
 * resolved is deliberately NOT a legal source for close/archive/hide:
 * resolved → archived → restore → open would be an unrevisioned reopen that
 * bypasses review continuity (CTR-LIFE-004). deleted is terminal — a legal
 * TARGET from any non-deleted status, a legal source of NOTHING.
 */
const STATUS_TRANSITIONS: Record<
  ThreadStatusAction,
  { target: string; from: Set<string> }
> = {
  close: { target: 'closed', from: new Set(['open']) },
  archive: { target: 'archived', from: new Set(['open', 'closed']) },
  hide: { target: 'hidden', from: new Set(['open', 'closed']) },
  restore: { target: 'open', from: new Set(['hidden', 'archived', 'closed']) },
  // Finalization (review gate + outcome) may only START from open — resolve
  // must never double as a moderation/lifecycle bypass (reviving hidden,
  // archived or deleted content, or "un-hiding" via a status overwrite).
  resolve: { target: 'resolved', from: new Set(['open']) },
  softDelete: {
    target: 'deleted',
    from: new Set(['open', 'closed', 'resolved', 'archived', 'hidden']),
  },
};

/** Status each lifecycle action transitions TO. */
export const LIFECYCLE_TARGET_STATUS: Record<ThreadLifecycleAction, string> = {
  close: 'closed',
  archive: 'archived',
  hide: 'hidden',
  restore: 'open',
};

/**
 * Validate a status transition against the state machine.
 * @throws HttpError(400) on a no-op or illegal transition, with the current
 *   status in the message so the caller can distinguish "already closed"
 *   from "cannot hide an archived thread".
 */
export function assertLifecycleTransition(
  action: ThreadStatusAction,
  currentStatus: string,
): string {
  const { target, from } = STATUS_TRANSITIONS[action];
  if (currentStatus === target) {
    throw new HttpError(400, `Thread already ${target}`);
  }
  if (!from.has(currentStatus)) {
    throw new HttpError(
      400,
      `Cannot ${action} a thread in status "${currentStatus}"`,
    );
  }
  return target;
}

/** Statuses that block new messages (history stays readable). */
export const MESSAGE_BLOCKING_STATUSES = ['closed', 'archived', 'hidden', 'deleted'];

// ── Ordinary vs governance read visibility ──────────────────────────────────

export const GOVERNANCE_SCOPE_NAMES = ['forum.moderate', 'forum.admin'] as const;

export function hasGovernanceAuthority(scopes: readonly string[] | undefined | null): boolean {
  return (
    !!scopes &&
    GOVERNANCE_SCOPE_NAMES.some((scope) => scopes.includes(scope))
  );
}

/** Statuses invisible to ordinary (non-governance) callers on every surface. */
export const ORDINARY_INVISIBLE_STATUSES = ['hidden', 'deleted'] as const;

export function isVisibleToOrdinaryReaders(status: string): boolean {
  return !(ORDINARY_INVISIBLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Unified ordinary-read visibility guard (CTR-DELETE-003 deleted policy +
 * hidden moderation overlay). Throws 404 — indistinguishable from a
 * nonexistent thread, no existence leak — when the thread is hidden/deleted
 * and the caller lacks governance scope. Moderator/Admin callers pass and
 * retain governance read access on the same surfaces.
 */
export function assertOrdinaryReadVisibility(
  thread: { status: string },
  scopes: readonly string[] | undefined | null,
): void {
  if (isVisibleToOrdinaryReaders(thread.status)) return;
  if (hasGovernanceAuthority(scopes)) return;
  throw new HttpError(404, 'Thread not found');
}

// ── Governance action orchestration (single transaction) ────────────────────

export interface GovernanceActionSpec {
  actor: AuditActor;
  eventType: AuditEventType;
  targetType: AuditTargetType;
  targetId: string;
  threadId?: string | null;
  revision?: number | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Notification reason for thread participants; omit to skip fan-out. */
  notifyReason?: NotificationReason;
}

/**
 * Run a governance action atomically:
 *   1. apply the entity mutation (fn receives the transaction client and the
 *      freshly appended audit event — notifications key on its eventId)
 *   2. append the audit event (provenance='runtime')
 *   3. fan out notifications to thread participants (excluding the actor)
 *
 * Ordering inside the transaction: the audit event is appended FIRST (its id
 * becomes the notification sourceEventKey), then the caller's mutation runs,
 * then notifications fan out. If ANY step throws, everything rolls back —
 * in particular an audit append failure fails the governance action.
 *
 * Serializable isolation + withTransactionRetry make concurrent governance
 * actions on the same thread safe to retry; notification fan-out is idempotent
 * via (recipientPrincipalId, sourceEventKey).
 */
export async function applyGovernanceAction<T>(
  spec: GovernanceActionSpec,
  mutate: (
    tx: any,
    auditEvent: { eventId: string },
  ) => Promise<T>,
): Promise<{ result: T; auditEventId: string }> {
  const prisma = getPrisma();
  const { result, auditEventId } = await withTransactionRetry(async (tx) => {
    // 1. Append the audit event first — the action must never succeed
    //    unrecorded, and its id keys the notification fan-out.
    const auditEvent = await appendAuditEvent(
      {
        actor: spec.actor,
        eventType: spec.eventType,
        targetType: spec.targetType,
        targetId: spec.targetId,
        threadId: spec.threadId ?? null,
        revision: spec.revision ?? null,
        fromStatus: spec.fromStatus ?? null,
        toStatus: spec.toStatus ?? null,
        reason: spec.reason ?? null,
        metadata: spec.metadata ?? null,
      },
      tx,
    );

    // 2. Apply the entity mutation with the same transaction client.
    const mutated = await mutate(tx, { eventId: auditEvent.eventId });

    // 3. Fan out notifications to participants (same transaction).
    if (spec.threadId && spec.notifyReason) {
      await notifyThreadParticipants(tx, {
        threadId: spec.threadId,
        reason: spec.notifyReason,
        excludePrincipalId: spec.actor.id,
        sourceEventKey: `audit:${auditEvent.eventId}`,
        payload: {
          action: spec.eventType,
          fromStatus: spec.fromStatus ?? null,
          toStatus: spec.toStatus ?? null,
          reason: spec.reason ?? null,
        },
      });
    }

    return { result: mutated, auditEventId: auditEvent.eventId };
  });

  return { result, auditEventId };
}

/**
 * Create notification facts for every participant of a thread, keyed on the
 * originating governance event (idempotent under transaction retries).
 */
export async function notifyThreadParticipants(
  client: any,
  opts: {
    threadId: string;
    reason: NotificationReason;
    excludePrincipalId?: string;
    sourceEventKey: string;
    messageId?: string | null;
    payload?: Record<string, unknown> | null;
  },
) {
  const participants = await client.forumThreadParticipant.findMany({
    where: { threadId: opts.threadId, leftAt: null },
    select: { agentId: true },
  });
  if (participants.length === 0) return { count: 0 };

  // forum_participants.agentId stores the LOCAL principal id (see
  // data-access/watch.ts) — exactly the notification recipient key.
  const recipients = [
    ...new Set(participants.map((p: any) => p.agentId).filter(Boolean) as string[]),
  ].filter((principalId) => principalId !== opts.excludePrincipalId);

  return createNotificationFacts(
    recipients.map((principalId) => ({
      recipientPrincipalId: principalId,
      threadId: opts.threadId,
      messageId: opts.messageId ?? null,
      reason: opts.reason,
      sourceEventKey: opts.sourceEventKey,
      payload: opts.payload ?? null,
    })),
    client,
  );
}
