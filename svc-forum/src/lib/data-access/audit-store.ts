// audit-store.ts — Governance V1 runtime audit writer/reader.
//
// SINGLE audit model: forum_audit_events (append-only evidence storage from
// the additive-storage design). This module is its first runtime writer —
// every governance action appends ONE event with provenance='runtime'.
// The DB enforces append-only (forum_audit_events_append_only_tg rejects
// UPDATE/DELETE); the application role holds SELECT/INSERT only.
//
// Field mapping (governance semantics → evidence columns):
//   action      → eventType        ('thread.close' | 'thread.hide' | ...)
//   actor       → actorPrincipalId (FK, the resolved ForumPrincipal)
//                 + authSubject/agentId/clientId authentication-context
//                   snapshots (they grant no authority)
//   target      → targetType/targetId (+ threadId when thread-scoped)
//   from/to/reason/metadata → payload JSON (bounded, allowlisted keys only)
//   revision    → thread.currentRevision snapshot when available

import { prisma } from '../prisma.js';

export const AUDIT_EVENT_TYPES = [
  'thread.close',
  'thread.archive',
  'thread.hide',
  'thread.restore',
  'thread.resolve',
  'thread.pin',
  'thread.unpin',
  'thread.feature',
  'thread.unfeature',
  'thread.soft_delete',
  'message.soft_delete',
  'report.handle',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const AUDIT_TARGET_TYPES = ['thread', 'message', 'report'] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/** Authentication-context + identity of the acting principal (from req.user). */
export interface AuditActor {
  /** Local ForumPrincipal id (actorPrincipalId FK). */
  id: string;
  authSubject?: string;
  agentId?: string;
  clientId?: string;
  name: string;
  scopes: string[];
}

/** Allowlisted payload keys — never tokens, headers, or secrets. */
const PAYLOAD_KEYS = [
  'fromStatus',
  'toStatus',
  'reason',
  'actorName',
  'actorScopes',
  'metadata',
] as const;

function buildPayload(input: {
  fromStatus?: string | null;
  toStatus?: string | null;
  reason?: string | null;
  actorName: string;
  actorScopes: string[];
  metadata?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.fromStatus != null) payload.fromStatus = input.fromStatus;
  if (input.toStatus != null) payload.toStatus = input.toStatus;
  if (input.reason != null) payload.reason = input.reason;
  payload.actorName = input.actorName;
  payload.actorScopes = input.actorScopes;
  if (input.metadata) payload.metadata = input.metadata;
  return payload;
}

export interface AppendAuditEventInput {
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
}

/**
 * Append one audit event. Accepts a transaction client so the governance
 * orchestration can make this atomic with the entity update (if the append
 * fails, the whole governance action must fail).
 */
export async function appendAuditEvent(
  input: AppendAuditEventInput,
  client: any = prisma,
) {
  return client.forumAuditEvent.create({
    data: {
      eventType: input.eventType,
      actorPrincipalId: input.actor.id,
      authSubject: input.actor.authSubject ?? null,
      agentId: input.actor.agentId ?? null,
      clientId: input.actor.clientId ?? null,
      targetType: input.targetType,
      targetId: input.targetId,
      threadId: input.threadId ?? null,
      revision: input.revision ?? null,
      payload: buildPayload({
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        reason: input.reason,
        actorName: input.actor.name,
        actorScopes: input.actor.scopes,
        metadata: input.metadata,
      }) as any,
      provenance: 'runtime',
    },
  });
}

// ── Query side (GET /api/admin/audit-logs) ─────────────────────────────────

export interface AuditEventFilter {
  eventType?: string;
  targetType?: string;
  targetId?: string;
  actorAgentId?: string;
  page?: number;
  limit?: number;
}

export async function findAuditEvents(filter: AuditEventFilter = {}) {
  const page = filter.page || 1;
  const limit = Math.min(filter.limit || 20, 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filter.eventType) where.eventType = filter.eventType;
  if (filter.targetType) where.targetType = filter.targetType;
  if (filter.targetId) where.targetId = filter.targetId;
  if (filter.actorAgentId) where.agentId = filter.actorAgentId;

  const [rows, total] = await Promise.all([
    prisma.forumAuditEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { eventId: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.forumAuditEvent.count({ where }),
  ]);

  // Flatten the evidence rows into the governance audit-view shape used by
  // the admin API (from/to/reason come from the allowlisted payload).
  const items = rows.map((row: any) => ({
    eventId: row.eventId,
    eventType: row.eventType,
    actorPrincipalId: row.actorPrincipalId,
    actorAgentId: row.agentId,
    actorAuthSubject: row.authSubject,
    actorName: row.payload?.actorName ?? null,
    actorScopes: row.payload?.actorScopes ?? null,
    targetType: row.targetType,
    targetId: row.targetId,
    threadId: row.threadId,
    fromStatus: row.payload?.fromStatus ?? null,
    toStatus: row.payload?.toStatus ?? null,
    reason: row.payload?.reason ?? null,
    provenance: row.provenance,
    createdAt: row.createdAt,
  }));

  return { items, total, page, limit };
}
