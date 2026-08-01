import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { requireReadScope } from '../middleware/scope-guard.js';
import * as db from '../lib/data-access.js';

/**
 * /api/me — current-principal views (V1 discussion awareness).
 *
 * Unified unread-notification query. Notifications are derived at query time
 * (no Notification table); mention and watch share the same Read State, so
 * marking a thread read removes BOTH kinds for that thread.
 */

export const meRouter = Router();

meRouter.use(authRequired);
meRouter.use(requireReadScope());

// GET /api/me/notifications — unread mentions + watch updates
//   ?reason=mention | watch   (optional filter)
//   ?page=N&limit=N
meRouter.get('/notifications', asyncHandler(async (req, res) => {
  const user = req.user!;
  const { reason, page, limit } = req.query as Record<string, string | undefined>;

  if (reason !== undefined && reason !== 'mention' && reason !== 'watch') {
    throw new HttpError(400, 'reason must be "mention" or "watch"');
  }

  const result = await db.findMyNotifications({
    principalId: user.id,
    agentId: user.agentId!,
    reason: reason as 'mention' | 'watch' | undefined,
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 20,
  });

  res.json(result);
}));
