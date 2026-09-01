import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireForumWriter } from '../middleware/forum-writer.js';
import { requireWriteScope, requireReadScope } from '../middleware/scope-guard.js';
import { assertOrdinaryReadVisibility } from '../lib/governance.js';
import * as db from '../lib/data-access.js';

function p(req: { params: Record<string, any> }, key: string): string {
  const v = req.params[key];
  return Array.isArray(v) ? v[0] : v;
}

export const snapshotsRouter = Router({ mergeParams: true });

snapshotsRouter.use(authRequired);

// POST /api/threads/:threadId/context-snapshots — create snapshot
snapshotsRouter.post('/', requireForumWriter, requireWriteScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);

  const {
    snapshotType, sourceType, sourceRef, title,
    excerptMd, contentHash, snapshot, note,
  } = req.body;

  if (!sourceType || !sourceRef || !title) {
    throw new HttpError(400, 'sourceType, sourceRef, and title are required');
  }

  const user = req.user!;
  const snap = await db.createContextSnapshot({
    threadId,
    snapshotType: snapshotType || 'thread_creation',
    sourceType,
    sourceRef,
    title,
    excerptMd: excerptMd || null,
    contentHash: contentHash || null,
    snapshot: snapshot || null,
    takenById: user.id,
    takenByName: user.name,
    note: note || null,
  });

  res.status(201).json({ snapshot: snap });
}));

// GET /api/threads/:threadId/context-snapshots — list snapshots
snapshotsRouter.get('/', requireReadScope(), asyncHandler(async (req, res) => {
  const threadId = p(req, 'threadId');
  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');
  assertOrdinaryReadVisibility(thread, req.user?.scopes);

  const snapshots = await db.findSnapshotsByThreadId(threadId);
  res.json({ snapshots });
}));
