import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireForumWriter } from '../middleware/forum-writer.js';
import { requireWriteScope } from '../middleware/scope-guard.js';
import * as db from '../lib/data-access.js';

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

export const threadsRouter = Router();

threadsRouter.use(authRequired);

// POST /api/threads — create thread
threadsRouter.post('/', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
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
threadsRouter.get('/', asyncHandler(async (req, res) => {
  const {
    type, status, agentId, contextType, contextId, q,
    page, limit,
  } = req.query as Record<string, string | undefined>;

  const result = await db.findThreads({
    type: type || undefined,
    status: status || undefined,
    agentId: agentId || undefined,
    contextType: contextType || undefined,
    contextId: contextId || undefined,
    q: q || undefined,
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 20,
  });

  res.json(result);
}));

// GET /api/threads/:threadId — get single thread
threadsRouter.get('/:threadId', asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  res.json({ thread });
}));

// PATCH /api/threads/:threadId — update thread
threadsRouter.patch('/:threadId', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const existing = await db.findThreadById(threadId);
  if (!existing) throw new HttpError(404, 'Thread not found');

  const allowed = ['title', 'type', 'status', 'contextType', 'contextId', 'pipeline', 'layer', 'tags'];
  const updateData: Record<string, any> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updateData[key] = req.body[key];
    }
  }

  const thread = await db.updateThread(threadId, updateData);
  res.json({ thread });
}));

// POST /api/threads/:threadId/resolve — resolve thread with outcome
threadsRouter.post('/:threadId/resolve', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
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
threadsRouter.post('/:threadId/archive', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const updated = await db.updateThread(thread.id, { status: 'archived' });
  res.json({ thread: updated });
}));

// GET /api/threads/:threadId/transcript — get transcript (MVP core)
threadsRouter.get('/:threadId/transcript', asyncHandler(async (req, res) => {
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
