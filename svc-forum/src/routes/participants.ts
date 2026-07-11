import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import * as db from '../lib/data-access.js';
import * as rt from '../lib/review-tasks-data.js';

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

export const participantsRouter = Router({ mergeParams: true });

participantsRouter.use(authRequired);

// POST /api/threads/:threadId/participants — add participant
participantsRouter.post('/', asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const { agentId, agentName, role, status } = req.body;
  if (!agentId) throw new HttpError(400, 'agentId is required');

  // Check for duplicate
  const existing = await db.findParticipant(threadId, agentId);
  if (existing) {
    // Idempotent — return existing
    res.status(200).json({ participant: existing });
    return;
  }

  const participant = await db.addParticipant({
    threadId,
    agentId,
    agentName: agentName || agentId,
    role: role || 'member',
    status: status || 'invited',
  });

  // Auto-create review task for required_reviewer
  if (role === 'required_reviewer' && thread.status !== 'resolved' && thread.status !== 'archived') {
    await rt.ensureReviewTask(threadId, agentId);
  }

  res.status(201).json({ participant });
}));

// GET /api/threads/:threadId/participants — list participants
participantsRouter.get('/', asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const participants = await db.findParticipantsByThreadId(threadId);
  res.json({ participants });
}));

// PATCH /api/threads/:threadId/participants/:participantId — update participant
participantsRouter.patch('/:participantId', asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const participantId = p(req, 'participantId');

  const prisma = getPrisma();
  const existing = await prisma.forumThreadParticipant.findUnique({
    where: { id: participantId },
  });
  if (!existing) throw new HttpError(404, 'Participant not found');

  const allowed = ['role', 'status', 'lastReadAt'];
  const updateData: Record<string, any> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updateData[key] = req.body[key];
    }
  }

  const participant = await db.updateParticipant(participantId, updateData);

  // If role changed to required_reviewer, auto-create review task
  if (updateData.role === 'required_reviewer' && existing.role !== 'required_reviewer') {
    const thread = await db.findThreadById(threadId);
    if (thread && thread.status !== 'resolved' && thread.status !== 'archived') {
      await rt.ensureReviewTask(threadId, existing.agentId);
    }
  }

  res.json({ participant });
}));

// DELETE /api/threads/:threadId/participants/:participantId — remove participant
participantsRouter.delete('/:participantId', asyncHandler(async (req, res) => {
  const participantId = p(req, 'participantId');

  const prisma = getPrisma();
  const existing = await prisma.forumThreadParticipant.findUnique({
    where: { id: participantId },
  });
  if (!existing) throw new HttpError(404, 'Participant not found');

  await db.softDeleteParticipant(participantId);
  res.json({ ok: true });
}));

// POST /api/threads/:threadId/participants/:agentId/waive-review — waive required reviewer
participantsRouter.post('/:agentId/waive-review', asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const agentId = p(req, 'agentId');

  const user = req.user!;

  // Verify thread exists
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  // Find the target participant
  const participant = await db.findParticipant(threadId, agentId);
  if (!participant) throw new HttpError(404, 'Participant not found');

  // Must be a required_reviewer
  if (participant.role !== 'required_reviewer') {
    throw new HttpError(400, 'Only required_reviewer participants can be waived');
  }

  // Already waived — idempotent
  if (participant.reviewWaivedAt && participant.reviewWaiverReason) {
    res.json({
      participant: {
        agentId: participant.agentId,
        agentName: participant.agentName,
        reviewWaivedAt: participant.reviewWaivedAt,
        reviewWaivedById: participant.reviewWaivedById,
        reviewWaiverReason: participant.reviewWaiverReason,
      },
    });
    return;
  }

  // Check if reviewer has already replied — 409
  const prisma = getPrisma();
  const hasReplied = await prisma.forumThreadMessage.findFirst({
    where: {
      threadId,
      authorId: agentId,
      deletedAt: null,
      kind: { not: 'system' },
    },
    select: { id: true },
  });
  if (hasReplied) {
    throw new HttpError(409, 'Reviewer has already posted a message, waiver not needed');
  }

  // Authorization: thread creator or moderator
  const isCreator = thread.createdById === user.id;
  const callerParticipant = await db.findParticipant(threadId, user.id);
  const isModerator = callerParticipant?.role === 'moderator';

  if (!isCreator && !isModerator) {
    throw new HttpError(403, 'Only thread creator or moderator can waive a reviewer');
  }

  // Validate reason
  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    throw new HttpError(400, 'waiver reason is required');
  }

  // Apply waiver
  const now = new Date();
  await db.updateParticipant(participant.id, {
    reviewWaivedAt: now,
    reviewWaivedById: user.id,
    reviewWaiverReason: reason.trim(),
  });

  // Cancel any open review tasks for this reviewer
  await rt.cancelTasksForAgent(threadId, agentId);

  res.json({
    participant: {
      agentId: participant.agentId,
      agentName: participant.agentName,
      reviewWaivedAt: now,
      reviewWaivedById: user.id,
      reviewWaiverReason: reason.trim(),
    },
  });
}));
