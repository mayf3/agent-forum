import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { authOptional } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.js';
import { threadsRouter } from './routes/threads.js';
import { messagesRouter } from './routes/messages.js';
import { participantsRouter } from './routes/participants.js';
import { snapshotsRouter } from './routes/context-snapshots.js';
import { outcomesRouter } from './routes/outcomes.js';
import { searchRouter } from './routes/search.js';

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
app.use('/api/threads/:threadId/messages', messagesRouter);
app.use('/api/threads/:threadId/participants', participantsRouter);
app.use('/api/threads/:threadId/context-snapshots', snapshotsRouter);
app.use('/api/threads/:threadId/outcomes', outcomesRouter);
app.use('/api/search', searchRouter);

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
