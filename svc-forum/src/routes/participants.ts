import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireForumWriter } from '../middleware/forum-writer.js';
import { requireWriteScope, requireReadScope } from '../middleware/scope-guard.js';
import { getPrisma } from '../lib/prisma.js';
import {
  assertOrdinaryReadVisibility,
  hasGovernanceAuthority,
  PARTICIPANT_ROLES,
  PARTICIPANT_STATUSES,
} from '../lib/governance.js';
import { isValidAgentId } from '../lib/forum-principal.js';
import * as db from '../lib/data-access.js';

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Resolve the acting caller's authority over participant presentation state
 * (CTR-AUTHZ-004): the thread creator or a verified forum.moderate/forum.admin
 * scope. A participant role string NEVER confers this authority (CTR-AUTHZ-003).
 */
function canManageParticipants(
  thread: { createdById: string },
  user: { id: string; scopes?: readonly string[] },
): boolean {
  return thread.createdById === user.id || hasGovernanceAuthority(user.scopes);
}

/**
 * Canonical identity resolution for a participant agent id (same contract as
 * mentions): the id must be well-formed AND resolve to an existing
 * ForumPrincipal — unknown ids are rejected 400 before any row is written.
 * The returned principal id is the participant-row key (forum_participants.
 * agent_id stores the LOCAL principal id — the notification fan-out's
 * recipient key), so a raw unresolvable body string can never reach the table.
 */
async function resolveParticipantKey(agentId: string): Promise<{ id: string; displayName: string | null }> {
  if (!isValidAgentId(agentId)) throw new HttpError(400, 'UNKNOWN_MENTION_AGENT');
  const resolved = await db.findPrincipalsByAgentIds([agentId]);
  const principal = resolved.get(agentId);
  if (!principal) throw new HttpError(400, 'UNKNOWN_MENTION_AGENT');
  return principal;
}

function assertParticipantEnum(role: unknown, status: unknown): void {
  if (role !== undefined && !(PARTICIPANT_ROLES as readonly string[]).includes(role as string)) {
    throw new HttpError(400, `role must be one of: ${PARTICIPANT_ROLES.join(', ')}`);
  }
  if (status !== undefined && !(PARTICIPANT_STATUSES as readonly string[]).includes(status as string)) {
    throw new HttpError(400, `status must be one of: ${PARTICIPANT_STATUSES.join(', ')}`);
  }
}

export const participantsRouter = Router({ mergeParams: true });

participantsRouter.use(authRequired);

// POST /api/threads/:threadId/participants — add participant
participantsRouter.post('/', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);
  if (thread.status === 'deleted') {
    // deleted is terminal — no participant rows may be appended to a tombstone
    throw new HttpError(400, 'Cannot add participants to a deleted thread');
  }

  const user = req.user!;
  const { agentId, agentName, role, status } = req.body;
  if (!agentId || typeof agentId !== 'string') throw new HttpError(400, 'agentId is required');
  assertParticipantEnum(role, status);
  const principal = await resolveParticipantKey(agentId);

  const isSelf = principal.id === user.id;
  if (!isSelf && !canManageParticipants(thread, user)) {
    throw new HttpError(403, 'Only the thread creator or a moderator/admin may add other participants');
  }
  // Self-service join may never self-assign a privileged role/status pair —
  // the participant role string carries no authority and must not appear to.
  if (isSelf && role !== undefined && role !== 'member') {
    throw new HttpError(403, 'Self-service participation is member-only; role changes require the thread creator or a moderator/admin');
  }

  // Check for duplicate
  const existing = await db.findParticipant(threadId, principal.id);
  if (existing) {
    // Idempotent — return existing
    res.status(200).json({ participant: existing });
    return;
  }

  const participant = await db.addParticipant({
    threadId,
    agentId: principal.id,
    agentName: agentName || principal.displayName || agentId,
    role: role || 'member',
    status: status || 'invited',
  });

  res.status(201).json({ participant });
}));

// GET /api/threads/:threadId/participants — list participants
participantsRouter.get('/', requireReadScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);

  const participants = await db.findParticipantsByThreadId(threadId);
  res.json({ participants });
}));

// PATCH /api/threads/:threadId/participants/:participantId — update participant
participantsRouter.patch('/:participantId', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const participantId = p(req, 'participantId');

  // Unified visibility guard (same as every other nested surface): an
  // ordinary caller cannot even see hidden/deleted threads — 404, no
  // existence leak. Governance callers retain access per CTR-GOV-HIDE.
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);

  const prisma = getPrisma();
  const existing = await prisma.forumThreadParticipant.findUnique({
    where: { id: participantId },
  });
  // Target must be resolved WITHIN the route thread — a participant id from
  // another thread is rejected as not found (CTR-AUTHZ-004).
  if (!existing || existing.threadId !== threadId) {
    throw new HttpError(404, 'Participant not found');
  }

  const user = req.user!;
  assertParticipantEnum(req.body.role, req.body.status);

  // Role/status are another principal's presentation + review state: mutating
  // them requires creator-or-governance authority (CTR-AUTHZ-004). A caller
  // may never elevate themselves through this route.
  const wantsRoleOrStatus = req.body.role !== undefined || req.body.status !== undefined;
  if (wantsRoleOrStatus && !canManageParticipants(thread, user)) {
    throw new HttpError(403, 'Only the thread creator or a moderator/admin may change participant roles');
  }
  // lastReadAt is self-service state (CTR-AUTHZ-005) — own row only.
  if (req.body.lastReadAt !== undefined && existing.agentId !== user.id) {
    throw new HttpError(403, 'lastReadAt is self-service only');
  }

  const allowed = ['role', 'status', 'lastReadAt'];
  const updateData: Record<string, any> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updateData[key] = req.body[key];
    }
  }
  if (updateData.lastReadAt !== undefined) {
    const at = new Date(updateData.lastReadAt);
    if (Number.isNaN(at.getTime())) throw new HttpError(400, 'lastReadAt must be a valid date');
    updateData.lastReadAt = at;
  }

  const participant = await db.updateParticipant(participantId, updateData);
  res.json({ participant });
}));

// DELETE /api/threads/:threadId/participants/:participantId — remove participant
participantsRouter.delete('/:participantId', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const participantId = p(req, 'participantId');

  // Same unified guard as PATCH above.
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);

  const prisma = getPrisma();
  const existing = await prisma.forumThreadParticipant.findUnique({
    where: { id: participantId },
  });
  if (!existing || existing.threadId !== threadId) {
    throw new HttpError(404, 'Participant not found');
  }

  // Removing ANOTHER principal's participation requires creator-or-governance
  // authority; leaving under one's own row is self-service (CTR-AUTHZ-004/005).
  const user = req.user!;
  if (existing.agentId !== user.id && !canManageParticipants(thread, user)) {
    throw new HttpError(403, 'Only the thread creator or a moderator/admin may remove other participants');
  }

  await db.softDeleteParticipant(participantId);
  res.json({ ok: true });
}));

// POST /api/threads/:threadId/participants/:agentId/waive-review — waive required reviewer
participantsRouter.post('/:agentId/waive-review', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const agentId = p(req, 'agentId');

  const user = req.user!;

  // Verify thread exists
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);

  // Find the target participant row. Rows are keyed by the stored agentId
  // (the canonical principal id for every row written through the guarded
  // POST path and watch/autowatch), so the route param must match that value.
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

  // Authorization: thread creator OR verified governance scope — a participant
  // role string (e.g. 'moderator') MUST NOT confer this authority
  // (CTR-AUTHZ-002/003/004).
  const isCreator = thread.createdById === user.id;
  if (!isCreator && !hasGovernanceAuthority(user.scopes)) {
    throw new HttpError(403, 'Only the thread creator or forum.moderate/forum.admin authority can waive a reviewer');
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
