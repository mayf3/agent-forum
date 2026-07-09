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
