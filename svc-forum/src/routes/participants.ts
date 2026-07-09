import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import * as db from '../lib/data-access.js';

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
