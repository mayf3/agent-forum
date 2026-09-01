import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireForumWriter } from '../middleware/forum-writer.js';
import { requireWriteScope, requireReadScope, requireModeratorScope, requireGovernanceScopes } from '../middleware/scope-guard.js';
import {
  applyGovernanceAction,
  assertLifecycleTransition,
  assertOrdinaryReadVisibility,
  hasGovernanceAuthority,
} from '../lib/governance.js';
import { appendAuditEvent } from '../lib/data-access/audit-store.js';
import { withTransactionRetry } from '../lib/data-access/shared.js';
import * as db from '../lib/data-access.js';

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

export const threadsRouter = Router();

// POST /api/threads — create thread
threadsRouter.post('/', authRequired, requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const {
    title, type, contextType, contextId, pipeline, layer,
    tags, participants,
  } = req.body;

  if (!title || !title.trim()) {
    throw new HttpError(400, 'title is required');
  }

  const user = req.user!;
  const thread = await db.createThread({
    title: title.trim(),
    type: type || 'discussion',
    contextType: contextType || null,
    contextId: contextId || null,
    pipeline: pipeline || null,
    layer: layer || null,
    tags: tags || [],
    createdById: user.id,
    createdByName: user.name,
    createdByType: 'agent',
  });

  // Optionally add participants from request body
  if (Array.isArray(participants)) {
    for (const p of participants) {
      await db.addParticipant({
        threadId: thread.id,
        agentId: p.agentId || user.id,
        agentName: p.agentName || user.name,
        role: p.role || 'member',
        status: p.status || 'invited',
      });
    }
  }

  // Always add creator as participant
  const creatorExists = await db.findParticipant(thread.id, user.id);
  if (!creatorExists) {
    await db.addParticipant({
      threadId: thread.id,
      agentId: user.id,
      agentName: user.name,
      role: 'creator',
      status: 'responded',
    });
  }

  res.status(201).json({ thread });
}));

// GET /api/threads — list threads
threadsRouter.get('/', authRequired, requireReadScope(), asyncHandler(async (req, res) => {
  const {
    type, status, agentId, contextType, contextId, q,
    page, limit, sort,
    pinned, featured, filter,
  } = req.query as Record<string, string | undefined>;

  if (sort !== undefined && sort !== 'latest' && sort !== 'recently-updated' && sort !== 'hot') {
    throw new HttpError(400, 'sort must be "latest", "recently-updated" or "hot"');
  }

  // Hidden/deleted threads are removed from public view: both are excluded
  // from the default listing, and explicit status=hidden / status=deleted
  // filters are governance-only (CTR-DELETE-003 + hidden overlay policy).
  if ((status === 'hidden' || status === 'deleted') && !hasGovernanceAuthority(req.user?.scopes)) {
    throw new HttpError(403, 'INSUFFICIENT_SCOPE: viewing hidden or deleted threads requires forum.moderate or forum.admin');
  }

  // Resolve pinned/featured from filter param or boolean params.
  // If filter is present, it takes priority — boolean pinned/featured are ignored (400 if also provided).
  let resolvedPinned: boolean | undefined;
  let resolvedFeatured: boolean | undefined;

  if (filter !== undefined) {
    // If boolean pinned/featured also provided, reject — filter takes priority
    if (pinned !== undefined || featured !== undefined) {
      throw new HttpError(400, 'Cannot use "filter" together with "pinned" or "featured" parameters; use one or the other');
    }

    const validFilters = new Set(['pinned', 'featured', 'pinned,featured', 'featured,pinned']);
    if (!validFilters.has(filter)) {
      throw new HttpError(400, 'filter must be one of: "pinned", "featured", "pinned,featured"');
    }

    const parts = filter.split(',').map(s => s.trim());
    if (parts.includes('pinned')) resolvedPinned = true;
    if (parts.includes('featured')) resolvedFeatured = true;
  } else {
    resolvedPinned = pinned === 'true' ? true : pinned === 'false' ? false : undefined;
    resolvedFeatured = featured === 'true' ? true : featured === 'false' ? false : undefined;
  }

  // Tag filtering: repeated tag=N params = AND (thread must contain all);
  // comma-separated tag=A,B = OR (thread must contain at least one).
  // Express gives repeated query keys as an array.
  const rawTags = req.query.tag;
  const tagValues: string[] = Array.isArray(rawTags)
    ? rawTags.filter((v): v is string => typeof v === 'string')
    : typeof rawTags === 'string'
      ? [rawTags]
      : [];
  const tagsAnd: string[] = [];
  const tagsOr: string[] = [];
  for (const tv of tagValues) {
    if (tv.includes(',')) {
      tagsOr.push(...tv.split(',').map(s => s.trim()).filter(Boolean));
    } else if (tv.trim()) {
      tagsAnd.push(tv.trim());
    }
  }

  const result = await db.findThreads({
    type: type || undefined,
    status: status || undefined,
    agentId: agentId || undefined,
    contextType: contextType || undefined,
    contextId: contextId || undefined,
    q: q || undefined,
    pinned: resolvedPinned,
    featured: resolvedFeatured,
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 20,
    sort: sort || undefined,
    tagsAnd: tagsAnd.length ? tagsAnd : undefined,
    tagsOr: tagsOr.length ? tagsOr : undefined,
  });

  res.json(result);
}));

// GET /api/threads/:threadId — get single thread
// Records a view (dedup per principal) on read; view recording is best-effort
// and never fails the response (AC#1/AC#4).
// Hidden AND deleted threads are invisible to non-governance callers (404,
// same as nonexistent — no existence leak); moderators/admins can inspect.
threadsRouter.get('/:threadId', authRequired, requireReadScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);

  const user = req.user!;
  void db.recordView(threadId, user.id).catch(() => {});

  res.json({ thread });
}));

// PATCH /api/threads/:threadId — update thread
// Object authority (CTR-AUTHZ-002): descriptive metadata changes require the
// thread CREATOR or governance scope (forum.moderate/forum.admin) — an
// ordinary writer cannot edit arbitrary threads. pinned/featured remain
// governance-only (audited flag toggles).
threadsRouter.patch('/:threadId', authRequired, requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const existing = await db.findThreadById(threadId);
  if (!existing) throw new HttpError(404, 'Thread not found');

  const user = req.user!;
  const canGovern = hasGovernanceAuthority(user.scopes);
  const isCreator = existing.createdById === user.id;

  // Unified visibility guard: hidden/deleted threads are invisible to
  // non-governance callers (404, no existence leak).
  assertOrdinaryReadVisibility(existing, user.scopes);

  if (existing.status === 'deleted') {
    // deleted is terminal — not even governance edits tombstoned metadata
    throw new HttpError(400, 'Cannot update a deleted thread');
  }

  if (!isCreator && !canGovern) {
    throw new HttpError(403, 'INSUFFICIENT_SCOPE: only the thread creator or a moderator/admin may update this thread');
  }

  // status is intentionally excluded — use dedicated governance endpoints:
  // POST /:threadId/close|archive|hide|restore (moderation router) and
  // POST /:threadId/resolve, DELETE /:threadId
  const allowed = ['title', 'type', 'contextType', 'contextId', 'pipeline', 'layer', 'tags'];

  // pinned/featured are moderator-only fields (governance actions — audited)
  const moderatorFields = ['pinned', 'featured'];
  const requestedModeratorFields = moderatorFields.filter(f => req.body[f] !== undefined);

  if (requestedModeratorFields.length > 0) {
    if (!canGovern) {
      throw new HttpError(403, 'INSUFFICIENT_SCOPE: required "forum.moderate" for pinned/featured');
    }
    allowed.push(...moderatorFields);
  }

  const updateData: Record<string, any> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updateData[key] = req.body[key];
    }
  }

  const flagActions: Record<string, { on: string; off: string }> = {
    pinned: { on: 'thread.pin', off: 'thread.unpin' },
    featured: { on: 'thread.feature', off: 'thread.unfeature' },
  };

  let thread;
  if (requestedModeratorFields.length > 0) {
    // Governance-audited path: the update AND every flag-toggle audit event
    // land in ONE transaction — a flag can never flip unrecorded.
    thread = await withTransactionRetry(async (tx: any) => {
      const updated = await tx.forumThread.update({ where: { id: threadId }, data: updateData });
      for (const field of requestedModeratorFields) {
        const before = (existing as any)[field] as boolean;
        const after = (updated as any)[field] as boolean;
        if (before !== after) {
          const actions = flagActions[field];
          await appendAuditEvent(
            {
              actor: {
                id: user.id,
                authSubject: user.authSubjectId,
                agentId: user.agentId,
                clientId: user.clientId,
                name: user.name,
                scopes: user.scopes,
              },
              eventType: (after ? actions.on : actions.off) as any,
              targetType: 'thread',
              targetId: threadId,
              threadId,
            },
            tx,
          );
        }
      }
      return updated;
    });
  } else {
    thread = await db.updateThread(threadId, updateData);
  }

  res.json({ thread });
}));

// DELETE /api/threads/:threadId — soft delete thread (moderator/admin only)
// Legacy moderation removal. New moderation flows should prefer hide (with a
// required reason) + restore; both keep history and are audited.
threadsRouter.delete('/:threadId', authRequired, requireGovernanceScopes(), requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const existing = await db.findThreadById(threadId);
  if (!existing) throw new HttpError(404, 'Thread not found');

  // Unified state-machine guard: deleted is terminal and reachable from any
  // non-deleted status (no route may write status outside this table).
  assertLifecycleTransition('softDelete', existing.status);

  const user = req.user!;

  // Single transaction: audit append → status flip → participant notices.
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
      eventType: 'thread.soft_delete',
      targetType: 'thread',
      targetId: threadId,
      threadId,
      revision: existing.currentRevision ?? null,
      fromStatus: existing.status,
      toStatus: 'deleted',
      notifyReason: 'moderator_notice',
    },
    (tx) => tx.forumThread.update({ where: { id: threadId }, data: { status: 'deleted' } }),
  );

  res.json({ thread: result });
}));

// POST /api/threads/:threadId/resolve — resolve thread with outcome
//
// B4 guard set (unified with the governance state machine):
//   actor    — thread creator OR governance scope (CTR-FINAL-001/CTR-AUTHZ-002);
//              an ordinary writer can no longer resolve arbitrary threads
//   state    — resolve only from status=open (assertLifecycleTransition);
//              hidden/deleted/archived/closed threads can NEVER be resolved,
//              so resolve can never revive moderated content (CTR-LIFE-005)
//   gate     — review readiness unchanged (409 with pending reviewer ids)
//   atomicity— outcome + status + audit (+ participant notice) in ONE
//              applyGovernanceAction transaction; no second status-write path
threadsRouter.post('/:threadId/resolve', authRequired, requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const user = req.user!;
  const canGovern = hasGovernanceAuthority(user.scopes);

  // Ordinary callers cannot even see hidden/deleted targets (no existence
  // leak through the resolve route).
  assertOrdinaryReadVisibility(thread, user.scopes);

  // Object authority: creator or governance (CTR-FINAL-001).
  if (thread.createdById !== user.id && !canGovern) {
    throw new HttpError(403, 'INSUFFICIENT_SCOPE: only the thread creator or a moderator/admin may resolve this thread');
  }

  // State guard: finalization starts only from an open thread.
  assertLifecycleTransition('resolve', thread.status);

  const { summaryMd, decisionsJson, actionItemsJson, rejectedOptionsJson, openQuestionsJson } = req.body;
  if (!summaryMd || !summaryMd.trim()) {
    throw new HttpError(400, 'summaryMd (outcome summary) is required to resolve thread');
  }

  // Resolve gate: all required reviewers must be satisfied
  const readiness = await db.getThreadReviewReadiness(threadId);
  if (readiness && !readiness.ready) {
    res.status(409).json({
      error: 'Required reviewers have not completed review',
      pendingReviewerIds: readiness.pendingReviewerIds,
    });
    return;
  }

  // Create outcome + flip status in the single audited governance
  // transaction (audit failure ⇒ nothing commits).
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
      eventType: 'thread.resolve',
      targetType: 'thread',
      targetId: threadId,
      threadId,
      revision: thread.currentRevision ?? null,
      fromStatus: thread.status,
      toStatus: 'resolved',
      notifyReason: 'thread_notice',
    },
    async (tx) => {
      await tx.forumOutcome.create({
        data: {
          threadId: thread.id,
          summaryMd: summaryMd.trim(),
          decisionsJson: decisionsJson || null,
          actionItemsJson: actionItemsJson || null,
          rejectedOptionsJson: rejectedOptionsJson || null,
          openQuestionsJson: openQuestionsJson || null,
          writebackTargetType: null,
          writebackTargetRef: null,
          createdById: user.id,
          createdByName: user.name,
        },
      });
      return tx.forumThread.update({
        where: { id: thread.id },
        data: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedById: user.id,
          resolvedByName: user.name,
        },
      });
    },
  );

  res.json({ thread: result });
}));

// POST /api/threads/:threadId/archive — moved to the moderation router
// (Governance V1): archiving is a governance action requiring
// forum.moderate or forum.admin, audited in forum_audit_events.

// GET /api/threads/:threadId/transcript — get transcript (MVP core)
// Same unified visibility policy as detail: hidden/deleted transcripts are
// 404 for ordinary callers; governance callers retain read access.
threadsRouter.get('/:threadId/transcript', authRequired, requireReadScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const format = (req.query.format as string) || 'md';

  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);

  if (format === 'json') {
    const messages = await db.findMessagesByThreadId(threadId);
    const participants = await db.findParticipantsByThreadId(threadId);
    const outcomes = await db.findOutcomesByThreadId(threadId);
    const snapshots = await db.findSnapshotsByThreadId(threadId);
    res.json({ thread, participants, messages, outcomes, snapshots });
    return;
  }

  const md = await db.buildTranscriptMd(threadId);
  if (!md) throw new HttpError(404, 'Thread not found');

  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.send(md);
}));

// ── Self-service watch / read (V1 awareness) ─────────────────────────────
// The identity is ALWAYS the authenticated principal (req.user.id). The client
// never submits agentId/participantId here. Requires forum.write only — the
// original Participant management + review-flow routes are untouched.
// Self-service ops stay available on resolved/archived threads (CTR-LIFE-002)
// but follow the unified visibility policy for hidden/deleted targets.

async function requireWatchableThread(threadId: string, req: any) {
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);
  return thread;
}

// POST /api/threads/batch-read — mark multiple threads read
threadsRouter.post('/batch-read', authRequired, requireWriteScope(), asyncHandler(async (req, res) => {
  const { threadIds } = req.body;
  if (!Array.isArray(threadIds) || threadIds.length === 0) {
    throw new HttpError(400, 'threadIds must be a non-empty array');
  }
  if (threadIds.length > 50) {
    throw new HttpError(400, 'threadIds must not exceed 50 items per batch');
  }

  const user = req.user!;
  const result = await db.batchMarkRead(threadIds, user.id);
  res.json(result);
}));

// PUT /api/threads/:threadId/watch — watch this thread
threadsRouter.put('/:threadId/watch', authRequired, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  await requireWatchableThread(threadId, req);
  const user = req.user!;
  const participant = await db.watchThread(threadId, user.id, user.name);
  res.json({ participant });
}));

// DELETE /api/threads/:threadId/watch — unwatch this thread
threadsRouter.delete('/:threadId/watch', authRequired, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  await requireWatchableThread(threadId, req);
  const user = req.user!;
  const participant = await db.unwatchThread(threadId, user.id);
  res.json({ participant });
}));

// PUT /api/threads/:threadId/read — mark this thread read (derived Read State)
threadsRouter.put('/:threadId/read', authRequired, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  await requireWatchableThread(threadId, req);
  const user = req.user!;
  const participant = await db.markThreadRead(threadId, user.id);
  res.json({ participant });
}));
