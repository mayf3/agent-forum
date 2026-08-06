// shared.ts — 跨模块共享的类型定义、事务重试工具、mention 工具
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { HttpError } from '../../utils/http-error.js';
import { isValidAgentId } from '../forum-principal.js';

// ── Transaction retry ─────────────────────────────────────

const TX_RETRY_LIMIT = 3;
const TX_RETRY_DELAY_MS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableTxError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as any).code;
  return code === 'P2002' || code === 'P2034';
}

export async function withTransactionRetry<T>(
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

export { TX_RETRY_LIMIT, TX_RETRY_DELAY_MS };

// ── Mention normalization ──────────────────────────────────

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
