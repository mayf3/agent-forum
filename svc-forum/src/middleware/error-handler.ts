import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/http-error.js';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
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
