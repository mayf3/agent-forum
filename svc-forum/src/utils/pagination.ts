import { HttpError } from './http-error.js';

/**
 * Shared pagination parsing for list endpoints.
 *
 * Non-numeric / negative page or out-of-range limit must fail with a stable
 * 400 — Prisma would otherwise surface a driver error (500) or accept a
 * negative take as a reverse window.
 */
export function parsePagination(
  page: string | undefined,
  limit: string | undefined,
  defaults: { page: number; limit: number } = { page: 1, limit: 20 },
  maxLimit = 100,
): { page: number; limit: number } {
  let p = defaults.page;
  let l = defaults.limit;
  if (page !== undefined) {
    p = Number.parseInt(page, 10);
    if (!Number.isInteger(p) || p < 1) {
      throw new HttpError(400, 'page must be a positive integer');
    }
  }
  if (limit !== undefined) {
    l = Number.parseInt(limit, 10);
    if (!Number.isInteger(l) || l < 1 || l > maxLimit) {
      throw new HttpError(400, `limit must be an integer between 1 and ${maxLimit}`);
    }
  }
  return { page: p, limit: l };
}
