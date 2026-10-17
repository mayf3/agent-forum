import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireForumWriter } from '../middleware/forum-writer.js';
import { requireWriteScope, requireReadScope } from '../middleware/scope-guard.js';
import { getPrisma } from '../lib/prisma.js';
import { isUuid } from '../utils/uuid.js';
import * as db from '../lib/data-access.js';

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

export const participantsRouter = Router({ mergeParams: true });

participantsRouter.use(authRequired);

const MUTABLE_PARTICIPANT_ROLES = new Set(['member', 'required_reviewer']);
const MUTABLE_PARTICIPANT_STATUSES = new Set(['active', 'invited', 'responded']);

function requireParticipantMutationAuthority(
  thread: { createdById: string },
  user: { id: string; scopes: string[] },
): void {
  const isCreator = thread.createdById === user.id;
  const isModerator = user.scopes.includes('forum.moderate');
  if (!isCreator && !isModerator) {
    throw new HttpError(403, 'Only thread creator or moderator can mutate participants');
  }
}

function participantPresentationInput(body: Record<string, unknown>, defaults: boolean): {
  role?: string;
  status?: string;
} {
  const role = body.role ?? (defaults ? 'member' : undefined);
  const status = body.status ?? (defaults ? 'invited' : undefined);
  if (role !== undefined && (typeof role !== 'string' || !MUTABLE_PARTICIPANT_ROLES.has(role))) {
    throw new HttpError(400, 'role must be member or required_reviewer');
  }
  if (status !== undefined && (typeof status !== 'string' || !MUTABLE_PARTICIPANT_STATUSES.has(status))) {
    throw new HttpError(400, 'status must be active, invited, or responded');
  }
  if (body.lastReadAt !== undefined) {
    throw new HttpError(400, 'lastReadAt is self-service Read State and cannot be changed here');
  }
  return { role, status };
}

// POST /api/threads/:threadId/participants — add participant
participantsRouter.post('/', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread || thread.status === 'deleted') throw new HttpError(404, 'Thread not found');
  if (thread.status !== 'open') throw new HttpError(409, 'Thread is not open for participant changes');
  requireParticipantMutationAuthority(thread, req.user!);

  if (req.body.agentId !== undefined || req.body.agentName !== undefined) {
    throw new HttpError(400, 'Use stable principalId; agentId and agentName are not accepted');
  }
  const { principalId } = req.body;
  if (!isUuid(principalId)) throw new HttpError(400, 'principalId must be a valid UUID');
  const { role, status } = participantPresentationInput(req.body, true);

  const prisma = getPrisma();
  const principal = await prisma.forumPrincipal.findUnique({
    where: { id: principalId },
    select: { id: true, authSubject: true, agentId: true, displayName: true, status: true },
  });
  if (!principal) throw new HttpError(404, 'Forum Principal not found');
  if (principal.status !== 'active') throw new HttpError(409, 'Forum Principal is unavailable');

  // Legacy rows may use one of three historical identity namespaces. Treat
  // any exact alias as the same canonical target and return it idempotently,
  // rather than creating a new collision.
  const identifiers = [...new Set([
    principal.id,
    principal.authSubject,
    principal.agentId,
  ].filter((value): value is string => Boolean(value)))];
  for (const identifier of identifiers) {
    const existing = await db.findParticipant(threadId, identifier);
    if (existing) {
      res.status(200).json({ participant: existing });
      return;
    }
  }

  const participant = await db.addParticipant({
    threadId,
    agentId: principal.id,
    agentName: principal.displayName || principal.agentId || principal.id,
    role: role!,
    status: status!,
  });

  res.status(201).json({ participant });
}));

// GET /api/threads/:threadId/participants — list participants
participantsRouter.get('/', requireReadScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const participants = await db.findParticipantsByThreadId(threadId);
  res.json({ participants });
}));

// PATCH /api/threads/:threadId/participants/:participantId — update participant
participantsRouter.patch('/:participantId', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const participantId = p(req, 'participantId');

  const thread = await db.findThreadById(threadId);
  if (!thread || thread.status === 'deleted') throw new HttpError(404, 'Thread not found');
  if (thread.status !== 'open') throw new HttpError(409, 'Thread is not open for participant changes');

  const prisma = getPrisma();
  const existing = await prisma.forumThreadParticipant.findFirst({
    where: { id: participantId, threadId },
  });
  if (!existing) throw new HttpError(404, 'Participant not found');
  requireParticipantMutationAuthority(thread, req.user!);

  const updateData = participantPresentationInput(req.body, false);
  if (updateData.role === undefined && updateData.status === undefined) {
    throw new HttpError(400, 'role or status is required');
  }

  const participant = await db.updateParticipant(participantId, updateData);
  res.json({ participant });
}));

// DELETE /api/threads/:threadId/participants/:participantId — remove participant
participantsRouter.delete('/:participantId', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const participantId = p(req, 'participantId');

  const thread = await db.findThreadById(threadId);
  if (!thread || thread.status === 'deleted') throw new HttpError(404, 'Thread not found');
  if (thread.status !== 'open') throw new HttpError(409, 'Thread is not open for participant changes');

  const prisma = getPrisma();
  const existing = await prisma.forumThreadParticipant.findFirst({
    where: { id: participantId, threadId },
  });
  if (!existing) throw new HttpError(404, 'Participant not found');
  requireParticipantMutationAuthority(thread, req.user!);

  throw new HttpError(
    409,
    'LEGACY_PARTICIPANT_REMOVE_DISABLED: participant removal must not mutate Watch or Read State',
  );
}));

// POST /api/threads/:threadId/participants/:agentId/waive-review — waive required reviewer
participantsRouter.post('/:agentId/waive-review', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const agentId = p(req, 'agentId');

  const user = req.user!;

  // Verify thread exists
  const thread = await db.findThreadById(threadId);
  if (!thread || thread.status === 'deleted') throw new HttpError(404, 'Thread not found');
  if (thread.status !== 'open') throw new HttpError(409, 'Thread is not open for review changes');

  // Creator authority is bound to the immutable principal ID stored on the
  // Thread. Platform moderator authority comes only from the verified token
  // scope; a mutable Participant role never grants it.
  const isCreator = thread.createdById === user.id;
  const isModerator = user.scopes.includes('forum.moderate');
  if (!isCreator && !isModerator) {
    throw new HttpError(403, 'Only thread creator or moderator can waive a reviewer');
  }

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
