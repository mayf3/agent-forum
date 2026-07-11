import { Prisma } from '@prisma/client';
import { getPrisma } from './prisma.js';

export interface ReviewTaskResult {
  id: string;
  threadId: string;
  runId: string | null;
  assigneeAgentId: string;
  instruction: string | null;
  status: string;
  claimedAt: Date | null;
  claimedById: string | null;
  leaseExpiresAt: Date | null;
  attemptCount: number;
  completedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  lastError: string | null;
  resultMessageId: string | null;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskDetailResult {
  task: ReviewTaskResult;
  thread: {
    id: string;
    title: string;
    status: string;
  };
  instruction: string | null;
  transcriptMd: string | null;
  contextSnapshots: Array<{
    id: string;
    snapshotType: string;
    sourceType: string;
    sourceRef: string;
    title: string;
    excerptMd: string | null;
    takenAt: Date;
  }>;
}

// ── Create / Upsert ──

/**
 * Idempotently create a review task for a required_reviewer.
 * Returns the existing task if one already exists for this (threadId, assigneeAgentId).
 */
export async function ensureReviewTask(threadId: string, assigneeAgentId: string, instruction?: string) {
  const prisma = getPrisma();

  // Check if task already exists
  const existing = await prisma.forumReviewTask.findUnique({
    where: { threadId_assigneeAgentId: { threadId, assigneeAgentId } },
  });
  if (existing) return existing;

  const idempotencyKey = `review:${threadId}:${assigneeAgentId}`;

  return prisma.forumReviewTask.create({
    data: {
      threadId,
      assigneeAgentId,
      instruction: instruction || '请作为 required reviewer 审阅该 Thread，并发布 challenge、evidence、clarification 或 comment。',
      status: 'pending',
      idempotencyKey,
    },
  });
}

// ── Query ──

export interface InboxFilter {
  assigneeAgentId: string;
  status?: string;
  limit?: number;
}

/**
 * Get inbox tasks for an agent.
 * Defaults to pending tasks plus the agent's own claimed (non-expired) tasks.
 */
export async function findInboxTasks(filter: InboxFilter) {
  const prisma = getPrisma();
  const limit = Math.min(filter.limit || 20, 50);
  const now = new Date();

  const where: Prisma.ForumReviewTaskWhereInput = {
    assigneeAgentId: filter.assigneeAgentId,
  };

  if (filter.status) {
    where.status = filter.status;
  } else {
    // Default: pending tasks + claimed-by-me-non-expired
    where.OR = [
      { status: 'pending' },
      {
        status: 'claimed',
        claimedById: filter.assigneeAgentId,
        leaseExpiresAt: { gt: now },
      },
    ];
  }

  return prisma.forumReviewTask.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

export async function findReviewTaskById(id: string) {
  const prisma = getPrisma();
  return prisma.forumReviewTask.findUnique({ where: { id } });
}

export async function findTaskWithThread(id: string) {
  const prisma = getPrisma();
  return prisma.forumReviewTask.findUnique({
    where: { id },
    include: {
      thread: {
        select: { id: true, title: true, status: true },
      },
    },
  });
}

/**
 * Find a pending or claimed review task for a given thread + agent.
 * Used by manual completion logic.
 */
export async function findOpenTaskForReviewer(threadId: string, agentId: string) {
  const prisma = getPrisma();
  return prisma.forumReviewTask.findFirst({
    where: {
      threadId,
      assigneeAgentId: agentId,
      status: { in: ['pending', 'claimed'] },
    },
  });
}

// ── Claim ──

/**
 * Atomically claim a task using conditional update.
 * Returns the updated task if claim succeeded, or null if not.
 */
export async function claimTask(taskId: string, agentId: string): Promise<ReviewTaskResult | null> {
  const prisma = getPrisma();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + 10 * 60 * 1000); // +10 min

  // Use updateMany for atomic conditional update
  // Only allow: pending → claimed, or claimed-with-expired-lease → reclaim
  const result = await prisma.forumReviewTask.updateMany({
    where: {
      id: taskId,
      assigneeAgentId: agentId,
      status: { in: ['pending', 'claimed'] },
      NOT: { status: { in: ['completed', 'failed', 'cancelled'] } },
      // If currently claimed, only allow if lease expired
      OR: [
        { status: 'pending' },
        {
          status: 'claimed',
          leaseExpiresAt: { lte: now },
        },
      ],
    },
    data: {
      status: 'claimed',
      claimedAt: now,
      claimedById: agentId,
      leaseExpiresAt,
      attemptCount: { increment: 1 },
    },
  });

  if (result.count === 0) return null;

  return prisma.forumReviewTask.findUnique({ where: { id: taskId } }) as Promise<ReviewTaskResult>;
}

// ── Complete ──

/**
 * Complete a task and create a forum message in a single transaction.
 * Returns { message, task } or null if task could not be claimed for completion.
 */
export async function completeTaskWithMessage(
  taskId: string,
  agentId: string,
  content: string,
  kind: string,
  mentions: string[],
  authorName: string,
): Promise<{ message: any; task: ReviewTaskResult } | null> {
  const prisma = getPrisma();
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    // Step 1: Conditional update to claim completion right
    const result = await tx.forumReviewTask.updateMany({
      where: {
        id: taskId,
        assigneeAgentId: agentId,
        status: 'claimed',
        claimedById: agentId,
        leaseExpiresAt: { gt: now },
      },
      data: {
        status: 'completed',
        completedAt: now,
      },
    }) as any;

    if (result.count === 0) {
      // Check if already completed — idempotent
      const task = await tx.forumReviewTask.findUnique({ where: { id: taskId } }) as any;
      if (task && task.status === 'completed' && task.assigneeAgentId === agentId && task.resultMessageId) {
        // Already completed — return existing
        const message = await tx.forumThreadMessage.findUnique({ where: { id: task.resultMessageId } }) as any;
        return { message, task };
      }
      // Force rollback by returning a sentinel
      return null;
    }

    // Step 2: Create forum message
    const lastMsg = await tx.forumThreadMessage.findFirst({
      where: { threadId: (await tx.forumReviewTask.findUnique({ where: { id: taskId }, select: { threadId: true } })).threadId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    }) as any;
    const seq = (lastMsg?.seq || 0) + 1;

    const task = await tx.forumReviewTask.findUnique({ where: { id: taskId } }) as any;

    const message = await tx.forumThreadMessage.create({
      data: {
        threadId: task.threadId,
        parentId: null,
        seq,
        authorId: agentId,
        authorName,
        authorType: 'agent',
        kind,
        content,
        mentions: mentions || [],
        attachments: Prisma.JsonNull,
        metadata: Prisma.JsonNull,
      },
    }) as any;

    // Step 3: Update task resultMessageId
    await tx.forumReviewTask.update({
      where: { id: taskId },
      data: { resultMessageId: message.id },
    }) as any;

    // Step 4: Update thread messageCount and lastMessageAt
    const msgCount = await tx.forumThreadMessage.count({
      where: { threadId: task.threadId, deletedAt: null },
    }) as any;
    await tx.forumThread.update({
      where: { id: task.threadId },
      data: { messageCount: msgCount, lastMessageAt: new Date() },
    }) as any;

    return { message, task: { ...task, status: 'completed', completedAt: now, resultMessageId: message.id } };
  });
}

/**
 * Complete a review task via manual message (reviewer posted directly).
 * Called from message creation route in same transaction.
 */
export async function completeReviewTaskByMessage(
  tx: any,
  threadId: string,
  agentId: string,
  messageId: string,
): Promise<boolean> {
  const now = new Date();

  // Find open (pending or claimed) task for this reviewer in this thread
  const task = await tx.forumReviewTask.findFirst({
    where: {
      threadId,
      assigneeAgentId: agentId,
      status: { in: ['pending', 'claimed'] },
    },
  });

  if (!task) return false; // No open task to complete

  // Only complete if not already completed
  if (task.status === 'completed') return false;

  await tx.forumReviewTask.update({
    where: { id: task.id },
    data: {
      status: 'completed',
      completedAt: now,
      resultMessageId: messageId,
    },
  });

  return true;
}

// ── Fail ──

export async function failTask(taskId: string, agentId: string, error: string): Promise<boolean> {
  const prisma = getPrisma();
  const now = new Date();

  const result = await prisma.forumReviewTask.updateMany({
    where: {
      id: taskId,
      assigneeAgentId: agentId,
      status: 'claimed',
      claimedById: agentId,
    },
    data: {
      status: 'failed',
      failedAt: now,
      lastError: error,
    },
  });

  return result.count > 0;
}

// ── Cancel (for waiver / resolve) ──

export async function cancelTasksForAgent(threadId: string, agentId: string) {
  const prisma = getPrisma();
  const now = new Date();

  const result = await prisma.forumReviewTask.updateMany({
    where: {
      threadId,
      assigneeAgentId: agentId,
      status: { in: ['pending', 'claimed'] },
    },
    data: {
      status: 'cancelled',
      cancelledAt: now,
    },
  });

  return result.count;
}

export async function cancelAllOpenTasksForThread(threadId: string) {
  const prisma = getPrisma();
  const now = new Date();

  const result = await prisma.forumReviewTask.updateMany({
    where: {
      threadId,
      status: { in: ['pending', 'claimed'] },
    },
    data: {
      status: 'cancelled',
      cancelledAt: now,
    },
  });

  return result.count;
}

// ── Build context for task detail ──

export async function buildTaskContext(taskId: string) {
  const prisma = getPrisma();

  const task = await prisma.forumReviewTask.findUnique({
    where: { id: taskId },
    include: {
      thread: {
        select: { id: true, title: true, status: true },
      },
    },
  });
  if (!task) return null;

  const { buildTranscriptMd } = await import('./data-access.js');
  const transcriptMd = await buildTranscriptMd(task.threadId);

  const snapshots = await prisma.forumContextSnapshot.findMany({
    where: { threadId: task.threadId },
    orderBy: { takenAt: 'desc' },
    select: {
      id: true,
      snapshotType: true,
      sourceType: true,
      sourceRef: true,
      title: true,
      excerptMd: true,
      takenAt: true,
    },
  });

  return {
    task: {
      id: task.id,
      threadId: task.threadId,
      assigneeAgentId: task.assigneeAgentId,
      status: task.status,
      instruction: task.instruction,
      claimedAt: task.claimedAt,
      claimedById: task.claimedById,
      leaseExpiresAt: task.leaseExpiresAt,
      attemptCount: task.attemptCount,
      completedAt: task.completedAt,
      failedAt: task.failedAt,
      cancelledAt: task.cancelledAt,
      lastError: task.lastError,
      resultMessageId: task.resultMessageId,
      createdAt: task.createdAt,
    },
    thread: task.thread,
    instruction: task.instruction,
    transcriptMd,
    contextSnapshots: snapshots,
  };
}
