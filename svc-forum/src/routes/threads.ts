import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireForumWriter } from '../middleware/forum-writer.js';
import { requireWriteScope, requireReadScope, requireModeratorScope } from '../middleware/scope-guard.js';
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
threadsRouter.get('/:threadId', authRequired, requireReadScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const user = req.user!;
  void db.recordView(threadId, user.id).catch(() => {});

  res.json({ thread });
}));

// PATCH /api/threads/:threadId — update thread
threadsRouter.patch('/:threadId', authRequired, requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const existing = await db.findThreadById(threadId);
  if (!existing) throw new HttpError(404, 'Thread not found');

  // status is intentionally excluded — use dedicated endpoints:
  // POST /:threadId/resolve, POST /:threadId/archive, DELETE /:threadId
  const allowed = ['title', 'type', 'contextType', 'contextId', 'pipeline', 'layer', 'tags'];

  // pinned/featured are moderator-only fields
  const moderatorFields = ['pinned', 'featured'];
  const requestingModeratorFields = moderatorFields.some(f => req.body[f] !== undefined);

  if (requestingModeratorFields) {
    // Verify the caller has forum.moderate scope
    const userScopes = req.user!.scopes || [];
    if (!userScopes.includes('forum.moderate')) {
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

  const thread = await db.updateThread(threadId, updateData);
  res.json({ thread });
}));

// DELETE /api/threads/:threadId — soft delete thread (moderator only)
threadsRouter.delete('/:threadId', authRequired, requireForumWriter, requireModeratorScope(), requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const existing = await db.findThreadById(threadId);
  if (!existing) throw new HttpError(404, 'Thread not found');
  if (existing.status === 'deleted') throw new HttpError(400, 'Thread already deleted');

  const thread = await db.softDeleteThread(threadId);
  res.json({ thread });
}));

// POST /api/threads/:threadId/resolve — resolve thread with outcome
threadsRouter.post('/:threadId/resolve', authRequired, requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  // Resolve gate: all required reviewers must be satisfied
  const readiness = await db.getThreadReviewReadiness(threadId);
  if (readiness && !readiness.ready) {
    res.status(409).json({
      error: 'Required reviewers have not completed review',
      pendingReviewerIds: readiness.pendingReviewerIds,
    });
    return;
  }

  const { summaryMd, decisionsJson, actionItemsJson, rejectedOptionsJson, openQuestionsJson } = req.body;
  if (!summaryMd || !summaryMd.trim()) {
    throw new HttpError(400, 'summaryMd (outcome summary) is required to resolve thread');
  }

  const user = req.user!;

  // Create outcome
  await db.createOutcome({
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
  });

  // Resolve thread
  const updated = await db.updateThread(thread.id, {
    status: 'resolved',
    resolvedAt: new Date(),
    resolvedById: user.id,
    resolvedByName: user.name,
  });

  res.json({ thread: updated });
}));

// POST /api/threads/:threadId/archive — archive thread
threadsRouter.post('/:threadId/archive', authRequired, requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const updated = await db.updateThread(thread.id, { status: 'archived' });
  res.json({ thread: updated });
}));

// GET /api/threads/:threadId/transcript — get transcript (MVP core)
threadsRouter.get('/:threadId/transcript', authRequired, requireReadScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const format = (req.query.format as string) || 'md';

  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

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
  const user = req.user!;
  const participant = await db.watchThread(threadId, user.id, user.name);
  res.json({ participant });
}));

// DELETE /api/threads/:threadId/watch — unwatch this thread
threadsRouter.delete('/:threadId/watch', authRequired, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const user = req.user!;
  const participant = await db.unwatchThread(threadId, user.id);
  res.json({ participant });
}));

// PUT /api/threads/:threadId/read — mark this thread read (derived Read State)
threadsRouter.put('/:threadId/read', authRequired, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const user = req.user!;
  const participant = await db.markThreadRead(threadId, user.id);
  res.json({ participant });
}));
