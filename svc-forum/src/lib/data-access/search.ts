// search.ts — 全文搜索（AC: relevance + excerpt + pagination，合并自 feat/fulltext-search-d56dd713）
import { prisma } from '../prisma.js';

// ── Search ─────────────────────────────────────────────────

// ── Search (full-text, AC: relevance + excerpt + pagination) ───────────────

const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 100;
const EXCERPT_RADIUS = 50;
const EXCERPT_MAX = 120;

/** Extract a snippet around the first case-insensitive match of q in text. */
export function extractExcerpt(text: string, q: string): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return text.slice(0, EXCERPT_MAX);
  const start = Math.max(0, idx - EXCERPT_RADIUS);
  const end = Math.min(text.length, idx + q.length + EXCERPT_RADIUS);
  let excerpt = text.slice(start, end);
  if (start > 0) excerpt = '…' + excerpt;
  if (end < text.length) excerpt = excerpt + '…';
  return excerpt.slice(0, EXCERPT_MAX);
}

/**
 * Relevance score (application-layer; PostgreSQL ILIKE has no built-in ranking):
 *   title exact match  +10
 *   title contains     +5
 *   content contains   +2 per hit (capped at 3 hits)
 */
export function relevanceScore(text: string, q: string, isTitle: boolean): number {
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  if (isTitle && lower === needle) return 10;
  if (lower.includes(needle)) {
    let count = 0;
    let from = 0;
    while (count < 3) {
      const hit = lower.indexOf(needle, from);
      if (hit < 0) break;
      count += 1;
      from = hit + needle.length;
    }
    return (isTitle ? 5 : 0) + count * 2;
  }
  return 0;
}

export interface SearchResultItem {
  score: number;
  excerpt?: string;
  [key: string]: any;
}

export interface SearchResults {
  threads: SearchResultItem[];
  messages: SearchResultItem[];
  outcomes: SearchResultItem[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export async function searchAll(q: string, page = 1, limit = SEARCH_DEFAULT_LIMIT): Promise<SearchResults> {
  const safeLimit = Math.min(Math.max(1, limit), SEARCH_MAX_LIMIT);
  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * safeLimit;

  const qLower = q.toLowerCase();

  const [threadHits, messageHits, outcomeHits] = await Promise.all([
    prisma.forumThread.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
        ],
      },
    }),
    prisma.forumThreadMessage.findMany({
      where: {
        deletedAt: null,
        content: { contains: q, mode: 'insensitive' },
      },
      include: {
        thread: { select: { id: true, title: true } },
      },
    }),
    prisma.forumOutcome.findMany({
      where: {
        summaryMd: { contains: q, mode: 'insensitive' },
      },
      include: {
        thread: { select: { id: true, title: true } },
      },
    }),
  ]);

  const total = threadHits.length + messageHits.length + outcomeHits.length;

  const scoreThread = (t: any): SearchResultItem => ({
    ...t,
    score: relevanceScore(t.title, q, true),
    excerpt: extractExcerpt(t.title, q),
  });
  const scoreMessage = (m: any): SearchResultItem => ({
    ...m,
    score: relevanceScore(m.content, q, false),
    excerpt: extractExcerpt(m.content, q),
  });
  const scoreOutcome = (o: any): SearchResultItem => ({
    ...o,
    score: relevanceScore(o.summaryMd, q, false),
    excerpt: extractExcerpt(o.summaryMd, q),
  });

  // Relevance-ranked within each group (title hits rank above content hits by
  // the scoring function), then paginate across the merged, ranked list so the
  // strongest matches surface first regardless of source group.
  const merged = [
    ...threadHits.map(scoreThread),
    ...messageHits.map(scoreMessage),
    ...outcomeHits.map(scoreOutcome),
  ].sort((a, b) => b.score - a.score || (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0));

  const pageItems = merged.slice(skip, skip + safeLimit);

  return {
    threads: pageItems.filter(i => 'title' in i && !('content' in i) && !('summaryMd' in i)),
    messages: pageItems.filter(i => 'content' in i),
    outcomes: pageItems.filter(i => 'summaryMd' in i),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
}
