/**
 * Data access layer for DiscussionRun and DiscussionRunStep.
 */
import { getPrisma } from './prisma.js';

// ── Run ──

export interface CreateRunInput {
  threadId: string;
  title: string;
  description?: string | null;
  participantOrder: string[];
  maxRounds: number;
  maxMessages: number;
  idempotencyKey: string;
  source?: string | null;
  agentEndpoints?: Record<string, string> | null;
}

export async function createRun(data: CreateRunInput) {
  const prisma = getPrisma();
  const createData: any = { ...data };
  if (createData.agentEndpoints === undefined) {
    createData.agentEndpoints = null;
  }
  return prisma.discussionRun.create({ data: createData });
}

export async function findRunById(id: string) {
  const prisma = getPrisma();
  return prisma.discussionRun.findUnique({ where: { id } });
}

export async function findRunByIdempotencyKey(key: string) {
  const prisma = getPrisma();
  return prisma.discussionRun.findUnique({ where: { idempotencyKey: key } });
}

export async function findRunsByThreadId(threadId: string) {
  const prisma = getPrisma();
  return prisma.discussionRun.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findActiveRunByThreadId(threadId: string) {
  const prisma = getPrisma();
  return prisma.discussionRun.findFirst({
    where: { threadId, status: 'running' },
  });
}

export async function updateRun(id: string, data: Record<string, any>) {
  const prisma = getPrisma();
  return prisma.discussionRun.update({ where: { id }, data });
}

// ── Steps ──

export interface CreateStepInput {
  runId: string;
  agentId: string;
  agentName: string;
  instruction?: string | null;
  seq: number;
}

export async function createStep(data: CreateStepInput) {
  const prisma = getPrisma();
  return prisma.discussionRunStep.create({ data });
}

export async function createSteps(steps: CreateStepInput[]) {
  const prisma = getPrisma();
  return prisma.discussionRunStep.createMany({ data: steps });
}

export async function findStepsByRunId(runId: string) {
  const prisma = getPrisma();
  return prisma.discussionRunStep.findMany({
    where: { runId },
    orderBy: { seq: 'asc' },
  });
}

export async function findStepById(id: string) {
  const prisma = getPrisma();
  return prisma.discussionRunStep.findUnique({ where: { id } });
}

export async function updateStep(id: string, data: Record<string, any>) {
  const prisma = getPrisma();
  return prisma.discussionRunStep.update({ where: { id }, data });
}

export async function updateStepByRunIdSeq(runId: string, seq: number, data: Record<string, any>) {
  const prisma = getPrisma();
  return prisma.discussionRunStep.update({
    where: { runId_seq: { runId, seq } },
    data,
  });
}

// ── Transactional helpers ──

export async function withTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  const prisma = getPrisma();
  return prisma.$transaction(fn);
}

/**
 * Atomically claim a run for starting.
 * Uses updateMany with a status filter to ensure only one concurrent
 * caller succeeds. Returns the claimed run or throws an error.
 */
export async function claimRunForStart(threadId: string, runId: string): Promise<any> {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    // 1. Read target run
    const run = await tx.discussionRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw Object.assign(new Error('Run not found'), { statusCode: 404 });
    }
    if (run.threadId !== threadId) {
      throw Object.assign(new Error('Run does not belong to this thread'), { statusCode: 400 });
    }

    // 2. Check run status (non-terminal, not already running)
    const terminalStatuses = ['succeeded', 'failed', 'cancelled'];
    if (terminalStatuses.includes(run.status)) {
      throw Object.assign(new Error(`Run already finished with status: ${run.status}`), { statusCode: 400 });
    }
    if (run.status === 'running') {
      throw Object.assign(new Error('Run is already running'), { statusCode: 400 });
    }

    // 3. Atomically claim via updateMany + partial unique index
    // The partial unique index "discussion_runs_one_running_per_thread"
    // ensures at most one 'running' row per threadId at the DB level,
    // replacing the unsafe read-then-check pattern.
    try {
      const result = await tx.discussionRun.updateMany({
        where: { id: runId, status: 'queued' },
        data: { status: 'running', startedAt: new Date() },
      });

      if (result.count === 0) {
        throw Object.assign(
          new Error('Run was already claimed by another request'),
          { statusCode: 409 },
        );
      }
    } catch (err: any) {
      // P2002 = unique constraint violation from the partial unique index.
      // This fires when another run on the same thread already has status='running'.
      if (err?.code === 'P2002') {
        throw Object.assign(
          new Error('Another run is already running for this thread'),
          { statusCode: 409 },
        );
      }
      throw err; // unknown error — rethrow
    }

    return tx.discussionRun.findUnique({ where: { id: runId } });
  });
}

/**
 * Atomically record a step message and mark step succeeded.
 * Combines message creation + step update + thread counter update
 * in a single transaction to prevent orphan messages.
 */
export async function recordStepAndMessage(
  runId: string,
  stepId: string,
  stepSeq: number,
  threadId: string,
  authorId: string,
  authorName: string,
  kind: string,
  content: string,
  mentions: string[],
): Promise<{ message: any; step: any }> {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    // 1. Get next seq for message
    const lastMsg = await tx.forumThreadMessage.findFirst({
      where: { threadId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    const msgSeq = (lastMsg?.seq || 0) + 1;

    // 2. Create message
    const message = await tx.forumThreadMessage.create({
      data: {
        threadId,
        seq: msgSeq,
        authorId,
        authorName,
        authorType: 'agent',
        kind,
        content,
        mentions,
      },
    });

    // 3. Update thread messageCount and lastMessageAt
    const msgCount = await tx.forumThreadMessage.count({
      where: { threadId, deletedAt: null },
    });
    await tx.forumThread.update({
      where: { id: threadId },
      data: { messageCount: msgCount, lastMessageAt: new Date() },
    });

    // 4. Update step
    const step = await tx.discussionRunStep.update({
      where: { id: stepId },
      data: {
        status: 'succeeded',
        resultMessageId: message.id,
        respondedAt: new Date(),
        finishedAt: new Date(),
      },
    });

    return { message, step };
  });
}

/**
 * Atomically mark a step as failed (without a message).
 */
export async function markStepFailed(runId: string, stepId: string, failureReason: string, errorDetail?: string) {
  const prisma = getPrisma();
  return prisma.discussionRunStep.update({
    where: { id: stepId },
    data: {
      status: 'failed',
      failureReason,
      errorDetail: errorDetail || null,
      finishedAt: new Date(),
    },
  });
}
