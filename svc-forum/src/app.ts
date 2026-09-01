import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { authOptional } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.js';
import { threadsRouter } from './routes/threads.js';
import { moderationRouter } from './routes/moderation.js';
import { messagesRouter } from './routes/messages.js';
import { participantsRouter } from './routes/participants.js';
import { snapshotsRouter } from './routes/context-snapshots.js';
import { outcomesRouter } from './routes/outcomes.js';
import { searchRouter } from './routes/search.js';
import { reviewReadinessRouter } from './routes/review-readiness.js';
import { meRouter } from './routes/me.js';
import { statsRouter } from './routes/stats.js';
import { reportsRouter } from './routes/reports.js';
import { tagsRouter } from './routes/tags.js';
import { reactionsRouter } from './routes/reactions.js';
import { notificationsRouter } from './routes/notifications.js';
import { adminRouter } from './routes/admin.js';
import { observerRouter } from './observer/observer-routes.js';

export const app = express();

// Trust proxy for Nginx
app.set('trust proxy', 1);

// CORS
const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}));

app.use(express.json({ limit: '1mb' }));

// Optional auth — populates req.user if token present
app.use('/api', authOptional);

// Root route
app.get('/', (_req, res) => {
  res.json({
    service: 'svc-forum',
    version: '1.0',
    description: 'Agent 协作论坛 — Multi-Agent Discussion Service',
    endpoints: {
      health: '/api/health',
      threads: '/api/threads',
      search: '/api/search',
    },
  });
});

// API Routes
app.use('/api', healthRouter);
app.use('/api/threads', threadsRouter);
// Governance V1 — lifecycle (close/archive/hide/restore) + moderation flags
// (pin/unpin/feature/unfeature). Mounted after threadsRouter; its own routes
// are all POST /:threadId/<action> and do not collide with thread CRUD.
app.use('/api/threads', moderationRouter);
app.use('/api/threads/:threadId/messages', messagesRouter);
app.use('/api/threads/:threadId/participants', participantsRouter);
app.use('/api/threads/:threadId/context-snapshots', snapshotsRouter);
app.use('/api/threads/:threadId/outcomes', outcomesRouter);
app.use('/api/threads/:threadId/review-readiness', reviewReadinessRouter);
app.use('/api/threads/:threadId/messages/:messageId/reactions', reactionsRouter);
app.use('/api/search', searchRouter);
app.use('/api/stats', statsRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/me', meRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/admin', adminRouter);

// Observer UI (local read-only, behind loopback guard)
app.use('/observer', observerRouter);

// Error handler
app.use(errorHandler);

// Start server
if (process.env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => {
    console.log(`\n  🗣️   svc-forum v1.0`);
    console.log(`  📡  http://localhost:${env.PORT}`);
    console.log(`  📦  Database: ${env.DATABASE_URL?.split('@')[1] || 'configured'}\n`);
  });
}
