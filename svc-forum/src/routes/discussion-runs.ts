import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import * as db from '../lib/data-access.js';
import * as runsDb from '../lib/discussion-runs-data.js';
import { validateRunLimits, executeRun } from '../lib/discussion-runner.js';

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

export const discussionRunsRouter = Router({ mergeParams: true });

discussionRunsRouter.use(authRequired);

// POST /api/threads/:threadId/runs — create a discussion run
discussionRunsRouter.post('/', asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const {
    title, description, participantOrder, maxRounds, maxMessages,
    idempotencyKey, agentEndpoints,
  } = req.body;

  if (!title || !title.trim()) throw new HttpError(400, 'title is required');
  if (!idempotencyKey) throw new HttpError(400, 'idempotencyKey is required');

  const mRounds = maxRounds || 1;
  const mMessages = maxMessages || 20;
  const order = participantOrder || [];

  const validationError = validateRunLimits(order, mRounds, mMessages);
  if (validationError) throw new HttpError(400, validationError);

  // Idempotency check
  const existing = await runsDb.findRunByIdempotencyKey(idempotencyKey);
  if (existing) {
    res.status(200).json({ run: existing });
    return;
  }

  // Resolve agent names from thread participants
  const participants = await db.findParticipantsByThreadId(threadId);
  const agentNameMap = new Map<string, string>();
  for (const p of participants) {
    agentNameMap.set(p.agentId, p.agentName);
  }
  // Also add creator
  agentNameMap.set(thread.createdById, thread.createdByName);

  const run = await runsDb.createRun({
    threadId,
    title: title.trim(),
    description: description || null,
    participantOrder: order,
    maxRounds: mRounds,
    maxMessages: mMessages,
    idempotencyKey,
    source: req.body.source || null,
    agentEndpoints: agentEndpoints || null,
  });

  // Generate steps: participantOrder × maxRounds
  let seq = 0;
  const steps: runsDb.CreateStepInput[] = [];
  for (let round = 0; round < mRounds; round++) {
    for (const agentId of order) {
      seq++;
      const agentName = agentNameMap.get(agentId) || agentId;
      steps.push({
        runId: run.id,
        agentId,
        agentName,
        instruction: round === 0 ? description || null : null,
        seq,
      });
    }
  }
  await runsDb.createSteps(steps);

  // Reload with steps
  const fullRun = await runsDb.findRunById(run.id);
  const createdSteps = await runsDb.findStepsByRunId(run.id);

  res.status(201).json({ run: fullRun, steps: createdSteps });
}));

// GET /api/threads/:threadId/runs — list runs
discussionRunsRouter.get('/', asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const runs = await runsDb.findRunsByThreadId(threadId);
  res.json({ runs });
}));

// GET /api/threads/:threadId/runs/:runId — get run
discussionRunsRouter.get('/:runId', asyncHandler(async (req, res) => {
  const runId = p(req, 'runId');
  const run = await runsDb.findRunById(runId);
  if (!run) throw new HttpError(404, 'Run not found');
  res.json({ run });
}));

// POST /api/threads/:threadId/runs/:runId/start — start a run
discussionRunsRouter.post('/:runId/start', asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const runId = p(req, 'runId');

  // M1: Verify caller is thread creator or participant
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const callerId = req.user!.id;
  const isCreator = thread.createdById === callerId;
  const participants = await db.findParticipantsByThreadId(threadId);
  const isParticipant = participants.some(p => p.agentId === callerId);
  if (!isCreator && !isParticipant) {
    throw new HttpError(403, 'Only thread creator or participants can start a run');
  }

  // H1: Atomically claim run for start — prevents concurrent execution
  let claimedRun: any;
  try {
    claimedRun = await runsDb.claimRunForStart(threadId, runId);
  } catch (err: any) {
    // Re-throw HttpError-compatible errors from claimRunForStart
    if (err.statusCode) {
      throw new HttpError(err.statusCode, err.message);
    }
    throw err;
  }

  // Execute run (synchronous MVP)
  // In production, this should be async (job queue)
  await executeRun(runId);

  const updatedRun = await runsDb.findRunById(runId);
  const steps = await runsDb.findStepsByRunId(runId);

  res.json({ run: updatedRun, steps });
}));

// PATCH /api/threads/:threadId/runs/:runId — update run (cancel)
discussionRunsRouter.patch('/:runId', asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const runId = p(req, 'runId');

  const run = await runsDb.findRunById(runId);
  if (!run) throw new HttpError(404, 'Run not found');
  if (run.threadId !== threadId) throw new HttpError(400, 'Run does not belong to this thread');

  const { status } = req.body;
  if (status === 'cancelled') {
    if (run.status === 'succeeded' || run.status === 'failed') {
      throw new HttpError(400, `Cannot cancel finished run with status: ${run.status}`);
    }
    const updated = await runsDb.updateRun(runId, {
      status: 'cancelled',
      finishedAt: new Date(),
    });
    res.json({ run: updated });
    return;
  }

  throw new HttpError(400, 'Only status=cancelled is supported');
}));

// GET /api/threads/:threadId/runs/:runId/steps — list steps
discussionRunsRouter.get('/:runId/steps', asyncHandler(async (req, res) => {
  const runId = p(req, 'runId');
  const run = await runsDb.findRunById(runId);
  if (!run) throw new HttpError(404, 'Run not found');

  const steps = await runsDb.findStepsByRunId(runId);
  res.json({ steps });
}));
