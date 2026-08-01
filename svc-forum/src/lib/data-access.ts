import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { isUuid } from '../utils/uuid.js';
import { HttpError } from '../utils/http-error.js';
import { isValidAgentId } from './forum-principal.js';

// ── Transaction retry ─────────────────────────────────────
//
// Concurrent writes to the same thread (message seq / lastMessageAt) and the
// same participant (threadId_agentId unique constraint) race with each other.
// P2002 (unique constraint) and P2034 (serialization/write conflict) are
// retried a bounded number of times; the whole transaction re-runs from
// scratch, so per-attempt state is never partially visible.

const TX_RETRY_LIMIT = 3;
const TX_RETRY_DELAY_MS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTxError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as any).code;
  return code === 'P2002' || code === 'P2034';
}

async function withTransactionRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      if (isRetryableTxError(err) && attempt < TX_RETRY_LIMIT) {
        await sleep(TX_RETRY_DELAY_MS * attempt);
        continue;
      }
      throw err;
    }
  }
}

// ── Mention normalization ──────────────────────────────────
//
// mentions[] stores business agent_ids (e.g. build-in-public-agent) exactly as
// they appear in the JWT agent_id claim. Unknown agent_ids are rejected before
// the message is created — never persisted and silently skipped.

export function normalizeMentions(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new HttpError(400, 'mentions must be an array of agent ids');
  }
  const out: string[] = [];
  for (const m of input) {
    if (typeof m !== 'string' || !isValidAgentId(m)) {
      throw new HttpError(400, `invalid mention: ${String(m)}`);
    }
    if (!out.includes(m)) out.push(m);
  }
  return out.sort();
}

/**
 * Resolve business agent_ids to local ForumPrincipal ids (read-only, run
 * OUTSIDE the write transaction). Returns Map<agentId, { id, displayName }>.
 */
export async function findPrincipalsByAgentIds(
  agentIds: string[],
): Promise<Map<string, { id: string; displayName: string | null }>> {
  const map = new Map<string, { id: string; displayName: string | null }>();
  if (agentIds.length === 0) return map;
  const rows = await prisma.forumPrincipal.findMany({
    where: { agentId: { in: agentIds } },
    select: { agentId: true, id: true, displayName: true },
  });
  for (const r of rows) {
    if (r.agentId) map.set(r.agentId, { id: r.id, displayName: r.displayName });
  }
  return map;
}

// ── Threads ────────────────────────────────────────────────

export interface CreateThreadInput {
  title: string;
  type: string;
  contextType?: string | null;
  contextId?: string | null;
  pipeline?: string | null;
  layer?: string | null;
  tags?: string[];
  createdById: string;
  createdByName: string;
  createdByType: string;
}

export interface ThreadFilter {
  type?: string;
  status?: string;
  agentId?: string;
  contextType?: string;
  contextId?: string;
  q?: string;
  page?: number;
  limit?: number;
  /** 'latest' → createdAt desc; 'recently-updated' (default) → lastMessageAt desc */
  sort?: 'latest' | 'recently-updated';
}

export async function createThread(data: CreateThreadInput) {
  return prisma.forumThread.create({ data });
}

export async function findThreadById(id: string) {
  if (!isUuid(id)) return null;
  return prisma.forumThread.findUnique({ where: { id } });
}

export async function findThreads(filter: ThreadFilter) {
  const page = filter.page || 1;
  const limit = Math.min(filter.limit || 20, 100);
  const skip = (page - 1) * limit;

  const where: Prisma.ForumThreadWhereInput = {};

  if (filter.type) where.type = filter.type;
  if (filter.status) where.status = filter.status;
  if (filter.contextType) where.contextType = filter.contextType;
  if (filter.contextId) where.contextId = filter.contextId;

  if (filter.agentId) {
    where.participants = { some: { agentId: filter.agentId } };
  }

  if (filter.q) {
    where.OR = [
      { title: { contains: filter.q, mode: 'insensitive' } },
    ];
  }

  const orderBy: Prisma.ForumThreadOrderByWithRelationInput =
    filter.sort === 'latest'
      ? { createdAt: 'desc' }
      : { lastMessageAt: { sort: 'desc', nulls: 'last' } };

  const [items, total] = await Promise.all([
    prisma.forumThread.findMany({
      where,
      orderBy,
      skip,
      take: limit,
    }),
    prisma.forumThread.count({ where }),
  ]);

  return { items, total, page, limit };
}

export async function updateThread(id: string, data: Prisma.ForumThreadUpdateInput) {
  if (!isUuid(id)) throw new Error('Invalid thread id format');
  return prisma.forumThread.update({ where: { id }, data });
}

// ── Messages ───────────────────────────────────────────────

export interface CreateMessageInput {
  threadId: string;
  parentId?: string | null;
  authorId: string;
  authorName: string;
  authorType: string;
  kind: string;
  content: string;
  mentions?: string[];
  /** Resolved by the caller (outside the transaction) — business agent_id → ForumPrincipal.id */
  mentionPrincipals?: Array<{ agentId: string; principalId: string; displayName: string | null }>;
  attachments?: any;
  metadata?: any;
}

/**
 * Create a message, advance the thread, and autowatch the author plus every
 * mentioned agent — all in ONE retryable transaction.
 *
 * Timestamp ordering (Codex-confirmed fix): joinedAt and message.createdAt are
 * both millisecond-precision; if they are equal a strict `>` unread query would
 * miss the very first mention. We therefore pin:
 *
 *   t0 = this watch/creation instant
 *   t1 = max(t0 + 1ms, previous thread.lastMessageAt + 1ms)
 *
 *   message.createdAt = t1   (explicit, never the DB default)
 *   new/rejoined participant.joinedAt = t0
 *
 * so message.createdAt is STRICTLY greater than the participant's unread
 * baseline in every freshly created watch edge.
 */
export async function createMessage(data: CreateMessageInput) {
  return withTransactionRetry(async (tx) => {
    const t0 = new Date();

    // Read current lastMessageAt to guarantee strictly increasing createdAt.
    const thread = await tx.forumThread.findUnique({
      where: { id: data.threadId },
      select: { lastMessageAt: true },
    });
    if (!thread) throw new HttpError(404, 'Thread not found');

    const prevTime = thread.lastMessageAt ? thread.lastMessageAt.getTime() : 0;
    const t1 = new Date(Math.max(t0.getTime() + 1, prevTime + 1));

    // Get next seq
    const lastMsg = await tx.forumThreadMessage.findFirst({
      where: { threadId: data.threadId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    const seq = (lastMsg?.seq || 0) + 1;

    const message = await tx.forumThreadMessage.create({
      data: {
        threadId: data.threadId,
        parentId: data.parentId || null,
        seq,
        authorId: data.authorId,
        authorName: data.authorName,
        authorType: data.authorType,
        kind: data.kind,
        content: data.content,
        mentions: data.mentions || [],
        createdAt: t1,
        attachments: data.attachments ?? Prisma.JsonNull,
        metadata: data.metadata ?? Prisma.JsonNull,
      },
    });

    // Update thread messageCount and lastMessageAt
    const msgCount = await tx.forumThreadMessage.count({
      where: { threadId: data.threadId, deletedAt: null },
    });
    await tx.forumThread.update({
      where: { id: data.threadId },
      data: { messageCount: msgCount, lastMessageAt: t1 },
    });

    // Author autowatch
    await autowatchThread(tx, data.threadId, data.authorId, data.authorName, t0, prevTime);

    // Mentioned agents autowatch (principal ids resolved by the caller)
    for (const m of data.mentionPrincipals || []) {
      await autowatchThread(tx, data.threadId, m.principalId, m.displayName || m.agentId, t0, prevTime);
    }

    return message;
  });
}

/**
 * Watch / re-watch a thread for a principal. Only touches watch fields:
 * joinedAt / leftAt / agentId / agentName. Never overwrites role, status,
 * reviewWaived*, or lastReadAt. Must be called inside the write transaction
 * (tx) so it never races the message create.
 *
 * joinedAt semantics (Codex-confirmed millisecond hazard):
 *   joinedAt = max(t0, prevLastMessageAtMs)
 *
 *   • first watch: messages posted before the watch are never unread, even
 *     when the watch lands in the same millisecond as the previous message
 *   • rejoin: messages posted during the unwatched gap never become unread
 *   • the in-flight message keeps its guarantee: its createdAt (t1) is
 *     STRICTLY greater than joinedAt because t1 = max(t0+1, prev+1) >
 *     max(t0, prev) = joinedAt
 */
async function autowatchThread(
  tx: Prisma.TransactionClient,
  threadId: string,
  principalId: string,
  agentName: string,
  t0: Date,
  prevLastMessageAtMs: number,
) {
  const existing = await tx.forumThreadParticipant.findUnique({
    where: { threadId_agentId: { threadId, agentId: principalId } },
  });

  const joinedAt = new Date(Math.max(t0.getTime(), prevLastMessageAtMs));

  if (!existing) {
    await tx.forumThreadParticipant.create({
      data: {
        threadId,
        agentId: principalId,
        agentName,
        role: 'member',
        status: 'active',
        joinedAt,
      },
    });
    return;
  }

  if (existing.leftAt !== null) {
    // Rejoin: baseline covers the unwatched gap; keep lastReadAt / role / status.
    await tx.forumThreadParticipant.update({
      where: { id: existing.id },
      data: { leftAt: null, joinedAt },
    });
  }
  // Already watching → no-op.
}

export async function findMessagesByThreadId(threadId: string) {
  if (!isUuid(threadId)) return [];
  return prisma.forumThreadMessage.findMany({
    where: { threadId, deletedAt: null },
    orderBy: { seq: 'asc' },
  });
}

export async function softDeleteMessage(id: string) {
  return prisma.forumThreadMessage.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ── Participants ───────────────────────────────────────────

export async function addParticipant(data: {
  threadId: string;
  agentId: string;
  agentName: string;
  role: string;
  status: string;
}) {
  return prisma.forumThreadParticipant.create({ data });
}

export async function findParticipant(threadId: string, agentId: string) {
  if (!isUuid(threadId)) return null;
  return prisma.forumThreadParticipant.findUnique({
    where: { threadId_agentId: { threadId, agentId } },
  });
}

export async function findParticipantsByThreadId(threadId: string) {
  if (!isUuid(threadId)) return [];
  return prisma.forumThreadParticipant.findMany({
    where: { threadId, leftAt: null },
  });
}

export async function updateParticipant(id: string, data: Prisma.ForumThreadParticipantUpdateInput) {
  return prisma.forumThreadParticipant.update({ where: { id }, data });
}

export async function softDeleteParticipant(id: string) {
  return prisma.forumThreadParticipant.update({
    where: { id },
    data: { leftAt: new Date() },
  });
}

// ── Self-service watch / read (V1 awareness) ───────────────
//
// The caller's identity comes from the server (req.user.id) — the client never
// submits agentId/participantId for these operations.

/**
 * Watch a thread for the current principal (idempotent):
 * absent → create; leftAt≠null → rejoin (gap-covered baseline); already watching → no-op.
 */
export async function watchThread(threadId: string, principalId: string, agentName: string) {
  if (!isUuid(threadId)) throw new HttpError(404, 'Thread not found');
  return withTransactionRetry(async (tx) => {
    const thread = await tx.forumThread.findUnique({
      where: { id: threadId },
      select: { lastMessageAt: true },
    });
    if (!thread) throw new HttpError(404, 'Thread not found');

    const now = new Date();
    const prevMs = thread.lastMessageAt ? thread.lastMessageAt.getTime() : 0;
    await autowatchThread(tx, threadId, principalId, agentName, now, prevMs);

    const participant = await tx.forumThreadParticipant.findUnique({
      where: { threadId_agentId: { threadId, agentId: principalId } },
    });
    return participant;
  });
}

/**
 * Unwatch a thread for the current principal (idempotent): writes leftAt=now.
 */
export async function unwatchThread(threadId: string, principalId: string) {
  if (!isUuid(threadId)) throw new HttpError(404, 'Thread not found');
  return withTransactionRetry(async (tx) => {
    const participant = await tx.forumThreadParticipant.findUnique({
      where: { threadId_agentId: { threadId, agentId: principalId } },
    });
    if (!participant) throw new HttpError(404, 'Not watching this thread');

    if (participant.leftAt !== null) return participant; // already unwatched — idempotent

    const now = new Date();
    await tx.forumThreadParticipant.update({
      where: { id: participant.id },
      data: { leftAt: now },
    });
    return { ...participant, leftAt: now };
  });
}

/**
 * Mark a thread read for the current principal.
 *
 * Read State must be derived from what was actually visible at read time:
 *   lastReadAt = max(previousLastReadAt, latest visible message createdAt)
 *
 * NEVER serverNow — that would skip concurrently-created messages the reader
 * has not seen. With no visible message the Read State is not advanced.
 */
export async function markThreadRead(threadId: string, principalId: string) {
  if (!isUuid(threadId)) throw new HttpError(404, 'Thread not found');
  return withTransactionRetry(async (tx) => {
    const participant = await tx.forumThreadParticipant.findUnique({
      where: { threadId_agentId: { threadId, agentId: principalId } },
    });
    if (!participant) throw new HttpError(404, 'Not watching this thread');

    const latest = await tx.forumThreadMessage.findFirst({
      where: { threadId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    let next: Date | null = null;
    if (latest) {
      next = participant.lastReadAt && participant.lastReadAt > latest.createdAt
        ? participant.lastReadAt
        : latest.createdAt;
    } else {
      next = participant.lastReadAt; // nothing visible — do not advance into the future
    }

    if (!next || next.getTime() === participant.lastReadAt?.getTime()) {
      return participant; // unchanged
    }

    await tx.forumThreadParticipant.update({
      where: { id: participant.id },
      data: { lastReadAt: next },
    });
    return { ...participant, lastReadAt: next };
  });
}

// ── Derived notifications (V1 awareness) ───────────────────
//
// No Notification table. Notifications are derived at query time from:
//   Message (mentions / createdAt / authorId / deletedAt)
//   Participant (joinedAt / lastReadAt / leftAt)
//
// unreadSince = max(joinedAt, lastReadAt ?? joinedAt)
//   first watch     → joinedAt
//   after reading   → lastReadAt
//   after rejoin    → the new joinedAt (messages from the unwatched gap never
//                     become unread again), independent of stale lastReadAt.

export interface NotificationItem {
  threadId: string;
  threadTitle: string;
  messageId: string;
  authorName: string;
  content: string;
  createdAt: Date;
  reason: 'mention' | 'watch';
}

export interface NotificationsResult {
  items: NotificationItem[];
  total: number;
  page: number;
  limit: number;
}

const NOTIFICATION_CHUNK_SIZE = 200; // OR-clause ceiling per DB query; correctness is never affected

export async function findMyNotifications(opts: {
  principalId: string;
  agentId: string;
  reason?: 'mention' | 'watch';
  page?: number;
  limit?: number;
}): Promise<NotificationsResult> {
  const page = opts.page || 1;
  const limit = Math.min(opts.limit || 20, 100);
  const skip = (page - 1) * limit;

  // Watched threads (leftAt IS NULL)
  const participants = await prisma.forumThreadParticipant.findMany({
    where: { agentId: opts.principalId, leftAt: null },
  });
  if (participants.length === 0) {
    return { items: [], total: 0, page, limit };
  }

  // Per-thread unread baseline
  const cutoffs = new Map<string, Date>();
  for (const p of participants) {
    const base = p.lastReadAt && p.lastReadAt > p.joinedAt ? p.lastReadAt : p.joinedAt;
    cutoffs.set(p.threadId, base);
  }

  const whereBase: Prisma.ForumThreadMessageWhereInput = {
    deletedAt: null,
    authorId: { not: opts.principalId }, // never notify about your own messages
    thread: { status: { not: 'archived' } },
  };

  // watch filter excludes messages that mention me (mention takes precedence);
  // Prisma 5.x list filters have no hasNot, so express it as a top-level NOT.
  if (opts.reason === 'watch') {
    whereBase.NOT = { mentions: { has: opts.agentId } };
  }

  const threadEntries = Array.from(cutoffs.entries());
  const all: Array<any> = [];
  let total = 0;

  for (let i = 0; i < threadEntries.length; i += NOTIFICATION_CHUNK_SIZE) {
    const chunk = threadEntries.slice(i, i + NOTIFICATION_CHUNK_SIZE);
    const or: Prisma.ForumThreadMessageWhereInput[] = chunk.map(([threadId, cutoff]) => {
      const clause: Prisma.ForumThreadMessageWhereInput = {
        threadId,
        createdAt: { gt: cutoff },
      };
      if (opts.reason === 'mention') clause.mentions = { has: opts.agentId };
      return clause;
    });

    const where: Prisma.ForumThreadMessageWhereInput = { ...whereBase, OR: or };
    const [items, count] = await Promise.all([
      prisma.forumThreadMessage.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { thread: { select: { id: true, title: true } } },
      }),
      prisma.forumThreadMessage.count({ where }),
    ]);
    all.push(...items);
    total += count;
  }

  // Stable sort: createdAt DESC, id DESC
  all.sort((a, b) => {
    const t = b.createdAt.getTime() - a.createdAt.getTime();
    if (t !== 0) return t;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  const items: NotificationItem[] = all.slice(skip, skip + limit).map((m) => ({
    threadId: m.threadId,
    threadTitle: m.thread.title,
    messageId: m.id,
    authorName: m.authorName,
    content: m.content,
    createdAt: m.createdAt,
    // A message that both mentions me and is a watch update is returned once,
    // with mention taking precedence (the watch branch excluded it upstream).
    reason: (m.mentions || []).includes(opts.agentId) ? 'mention' : 'watch',
  }));

  return { items, total, page, limit };
}

// ── Context Snapshots ──────────────────────────────────────

export async function createContextSnapshot(data: {
  threadId: string;
  snapshotType: string;
  sourceType: string;
  sourceRef: string;
  title: string;
  excerptMd?: string | null;
  contentHash?: string | null;
  snapshot?: any;
  takenById: string;
  takenByName: string;
  note?: string | null;
}) {
  return prisma.forumContextSnapshot.create({ data });
}

export async function findSnapshotsByThreadId(threadId: string) {
  if (!isUuid(threadId)) return [];
  return prisma.forumContextSnapshot.findMany({
    where: { threadId },
    orderBy: { takenAt: 'desc' },
  });
}

// ── Outcomes ───────────────────────────────────────────────

export async function createOutcome(data: {
  threadId: string;
  summaryMd: string;
  decisionsJson?: any;
  actionItemsJson?: any;
  rejectedOptionsJson?: any;
  openQuestionsJson?: any;
  writebackTargetType?: string | null;
  writebackTargetRef?: string | null;
  createdById: string;
  createdByName: string;
}) {
  return prisma.forumOutcome.create({ data });
}

export async function findOutcomesByThreadId(threadId: string) {
  if (!isUuid(threadId)) return [];
  return prisma.forumOutcome.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findLatestOutcomeByThreadId(threadId: string) {
  if (!isUuid(threadId)) return null;
  return prisma.forumOutcome.findFirst({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
  });
}

// ── Search ─────────────────────────────────────────────────

export async function searchAll(q: string) {
  const threads = await prisma.forumThread.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    take: 20,
  });

  const messages = await prisma.forumThreadMessage.findMany({
    where: {
      deletedAt: null,
      content: { contains: q, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      thread: { select: { id: true, title: true } },
    },
  });

  const outcomes = await prisma.forumOutcome.findMany({
    where: {
      summaryMd: { contains: q, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      thread: { select: { id: true, title: true } },
    },
  });

  return { threads, messages, outcomes };
}

// ── Review Readiness ────────────────────────────────────────

export interface ReviewReadinessResult {
  ready: boolean;
  requiredReviewers: Array<{
    agentId: string;
    agentName: string;
    satisfied: boolean;
    satisfiedBy: 'message' | 'waiver' | null;
    messageId?: string;
    waivedAt?: Date;
    waivedById?: string;
    waiverReason?: string;
  }>;
  pendingReviewerIds: string[];
}

export async function getThreadReviewReadiness(threadId: string): Promise<ReviewReadinessResult | null> {
  if (!isUuid(threadId)) return null;
  const thread = await prisma.forumThread.findUnique({ where: { id: threadId } });
  if (!thread) return null;

  const allParticipants = await findParticipantsByThreadId(threadId);
  const requiredReviewers = allParticipants.filter(p => p.role === 'required_reviewer');

  if (requiredReviewers.length === 0) {
    return { ready: true, requiredReviewers: [], pendingReviewerIds: [] };
  }

  // Get all non-system messages for this thread
  const messages = await prisma.forumThreadMessage.findMany({
    where: {
      threadId,
      deletedAt: null,
      kind: { not: 'system' },
    },
    select: { authorId: true, id: true },
  });

  const reviewerStatuses = requiredReviewers.map(r => {
    // Check A: reviewer has posted a non-system message
    const message = messages.find(m => m.authorId === r.agentId);
    if (message) {
      return {
        agentId: r.agentId,
        agentName: r.agentName,
        satisfied: true,
        satisfiedBy: 'message' as const,
        messageId: message.id,
      };
    }

    // Check B: reviewer has been waived
    if (r.reviewWaivedAt && r.reviewWaiverReason) {
      return {
        agentId: r.agentId,
        agentName: r.agentName,
        satisfied: true,
        satisfiedBy: 'waiver' as const,
        waivedAt: r.reviewWaivedAt,
        waivedById: r.reviewWaivedById ?? undefined,
        waiverReason: r.reviewWaiverReason,
      };
    }

    return {
      agentId: r.agentId,
      agentName: r.agentName,
      satisfied: false,
      satisfiedBy: null as null,
    };
  });

  const pendingReviewerIds = reviewerStatuses
    .filter(r => !r.satisfied)
    .map(r => r.agentId);

  return {
    ready: pendingReviewerIds.length === 0,
    requiredReviewers: reviewerStatuses,
    pendingReviewerIds,
  };
}

// ── Transcript ─────────────────────────────────────────────

export async function buildTranscriptMd(threadId: string) {
  if (!isUuid(threadId)) return null;
  const thread = await prisma.forumThread.findUnique({ where: { id: threadId } });
  if (!thread) return null;

  const participants = await findParticipantsByThreadId(threadId);
  const messages = await findMessagesByThreadId(threadId);
  const snapshots = await findSnapshotsByThreadId(threadId);
  const latestOutcome = await findLatestOutcomeByThreadId(threadId);

  let md = `# ${thread.title}\n\n`;
  md += `**Thread ID:** ${thread.id}\n`;
  md += `**Type:** ${thread.type}  |  **Status:** ${thread.status}\n`;
  md += `**Created by:** ${thread.createdByName} (${thread.createdByType})  |  **Created at:** ${thread.createdAt.toISOString()}\n`;
  if (thread.resolvedAt) {
    md += `**Resolved at:** ${thread.resolvedAt.toISOString()}  |  **Resolved by:** ${thread.resolvedByName || ''}\n`;
  }
  md += `**Messages:** ${thread.messageCount}\n`;
  if (thread.contextType && thread.contextId) {
    md += `**Context:** ${thread.contextType}:${thread.contextId}\n`;
  }
  if (thread.pipeline) md += `**Pipeline:** ${thread.pipeline}\n`;
  if (thread.layer) md += `**Layer:** ${thread.layer}\n`;
  if (thread.tags.length) md += `**Tags:** ${thread.tags.join(', ')}\n`;

  md += '\n## Participants\n\n';
  if (participants.length === 0) {
    md += '*No participants*\n';
  } else {
    for (const p of participants) {
      md += `- **${p.agentName}** (${p.role}) — ${p.status}\n`;
    }
  }

  md += '\n## Context Snapshots\n\n';
  if (snapshots.length === 0) {
    md += '*No context snapshots*\n';
  } else {
    for (const s of snapshots) {
      md += `- **${s.title}** (${s.sourceType}:${s.sourceRef}) — ${s.snapshotType}\n`;
      if (s.excerptMd) md += `  > ${s.excerptMd.replace(/\n/g, '\n  > ')}\n`;
    }
  }

  md += '\n## Messages\n\n';
  if (messages.length === 0) {
    md += '*No messages*\n';
  } else {
    for (const msg of messages) {
      const indent = msg.parentId ? '> ' : '';
      md += `### ${indent}Message #${msg.seq} — ${msg.authorName} (${msg.kind})\n`;
      md += `${indent}*${msg.createdAt.toISOString()}* | authorId: \`${msg.authorId || 'unavailable'}\`\n\n`;
      md += `${indent}${msg.content}\n\n`;
      if (msg.mentions && msg.mentions.length > 0) {
        md += `${indent}*Mentions: ${msg.mentions.join(', ')}*\n\n`;
      }
      if (msg.attachments) {
        md += `${indent}*Attachments: ${JSON.stringify(msg.attachments)}*\n\n`;
      }
    }
  }

  if (latestOutcome) {
    md += '## Outcome\n\n';
    md += `${latestOutcome.summaryMd}\n\n`;
    if (latestOutcome.decisionsJson) {
      md += '### Decisions\n\n';
      const decisions = Array.isArray(latestOutcome.decisionsJson)
        ? latestOutcome.decisionsJson
        : [latestOutcome.decisionsJson];
      for (const d of decisions) {
        md += `- ${typeof d === 'string' ? d : JSON.stringify(d)}\n`;
      }
      md += '\n';
    }
    if (latestOutcome.actionItemsJson) {
      md += '### Action Items\n\n';
      const items = Array.isArray(latestOutcome.actionItemsJson)
        ? latestOutcome.actionItemsJson
        : [latestOutcome.actionItemsJson];
      for (const a of items) {
        md += `- [ ] ${typeof a === 'string' ? a : JSON.stringify(a)}\n`;
      }
      md += '\n';
    }
  }

  return md;
}
