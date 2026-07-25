import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/http-error.js';

/**
 * Detect Express/body-parser JSON parse errors reliably.
 * body-parser sets `type='entity.parse.failed'` on a SyntaxError.
 * Both conditions must be true — plain SyntaxError from internal code
 * must NOT be mis-classified as malformed JSON.
 */
function isJsonParseError(err: unknown): boolean {
  return (
    err instanceof SyntaxError &&
    typeof err === 'object' &&
    err !== null &&
    (err as { type?: string }).type === 'entity.parse.failed'
  );
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  // Malformed JSON body → 400
  if (isJsonParseError(err)) {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  if (err.name === 'ZodError') {
    res.status(400).json({ error: '请求参数校验失败', details: (err as any).errors || (err as any).issues });
    return;
  }

  console.error('[svc-forum] Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
}
