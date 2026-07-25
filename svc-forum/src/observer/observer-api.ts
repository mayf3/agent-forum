import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { isUuid } from '../utils/uuid.js';
import * as db from '../lib/data-access.js';
import { observerGuard, readOnlyGuard } from './observer-middleware.js';

export const observerApiRouter = Router({ mergeParams: true });

// Guard: enabled + loopback + read-only
observerApiRouter.use(observerGuard, readOnlyGuard);

/**
 * Generate an 8-character short ID from a UUID for display purposes.
 * Uses the first 8 hex chars after the last hyphen group.
 */
function shortId(uuid: string): string {
  // Take the first 8 hex chars of the UUID (after removing dashes)
  return uuid.replace(/-/g, '').slice(0, 8);
}

/**
 * GET /observer/api/threads
 * List all threads with basic participant info.
 */
observerApiRouter.get('/threads', asyncHandler(async (_req, res) => {
  const result = await db.findThreads({
    page: 1,
    limit: 100,
  });

  // Enrich each thread with participant names
  const enriched = await Promise.all(result.items.map(async (thread) => {
    const participants = await db.findParticipantsByThreadId(thread.id);
    return {
      id: thread.id,
      shortId: shortId(thread.id),
      title: thread.title,
      status: thread.status,
      type: thread.type,
      messageCount: thread.messageCount,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      lastMessageAt: thread.lastMessageAt?.toISOString() || null,
      participantCount: participants.length,
      participants: participants.map(p => ({
        agentId: p.agentId,
        agentName: p.agentName,
        role: p.role,
        status: p.status,
      })),
    };
  }));

  res.json({ threads: enriched, total: result.total });
}));

/**
 * GET /observer/api/threads/:threadId
 * Get detailed thread info.
 */
observerApiRouter.get('/threads/:threadId', asyncHandler(async (req, res) => {
  const threadId = req.params.threadId;
  if (!isUuid(threadId)) {
    throw new HttpError(400, 'Invalid thread ID format — full UUID required');
  }

  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const participants = await db.findParticipantsByThreadId(threadId);

  res.json({
    thread: {
      id: thread.id,
      shortId: shortId(thread.id),
      title: thread.title,
      status: thread.status,
      type: thread.type,
      messageCount: thread.messageCount,
      contextType: thread.contextType,
      contextId: thread.contextId,
      pipeline: thread.pipeline,
      layer: thread.layer,
      tags: thread.tags,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      lastMessageAt: thread.lastMessageAt?.toISOString() || null,
      createdByName: thread.createdByName,
      createdByType: thread.createdByType,
      resolvedAt: thread.resolvedAt?.toISOString() || null,
      resolvedByName: thread.resolvedByName || null,
      participants: participants.map(p => ({
        agentId: p.agentId,
        agentName: p.agentName,
        role: p.role,
        status: p.status,
      })),
    },
  });
}));

/**
 * GET /observer/api/threads/:threadId/messages
 * Get all messages for a thread.
 */
observerApiRouter.get('/threads/:threadId/messages', asyncHandler(async (req, res) => {
  const threadId = req.params.threadId;
  if (!isUuid(threadId)) {
    throw new HttpError(400, 'Invalid thread ID format — full UUID required');
  }

  const thread = await db.findThreadById(threadId);
  if (!thread) throw new HttpError(404, 'Thread not found');

  const messages = await db.findMessagesByThreadId(threadId);

  res.json({
    threadId: thread.id,
    messageCount: messages.length,
    messages: messages.map(msg => ({
      id: msg.id,
      seq: msg.seq,
      authorId: msg.authorId,
      authorName: msg.authorName == null ? 'Unknown' : msg.authorName,
      authorType: msg.authorType,
      kind: msg.kind,
      content: msg.content,
      mentions: msg.mentions || [],
      parentId: msg.parentId || null,
      createdAt: msg.createdAt.toISOString(),
    })),
  });
}));

/**
 * GET /observer/api/threads/:threadId/transcript
 * Get the markdown transcript (pure text, no HTML).
 */
observerApiRouter.get('/threads/:threadId/transcript', asyncHandler(async (req, res) => {
  const threadId = req.params.threadId;
  if (!isUuid(threadId)) {
    throw new HttpError(400, 'Invalid thread ID format — full UUID required');
  }

  const md = await db.buildTranscriptMd(threadId);
  if (!md) throw new HttpError(404, 'Thread not found');

  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.send(md);
}));
