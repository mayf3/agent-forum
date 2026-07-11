import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import * as rt from '../lib/review-tasks-data.js';

export const agentTasksRouter = Router();

agentTasksRouter.use(authRequired);

/**
 * Agent-only middleware: requires role=agent and non-empty agentId.
 */
function requireAgent(req: Express.Request): string {
  const user = req.user;
  if (!user) throw new HttpError(401, '请先登录');
  if (user.role !== 'agent') throw new HttpError(403, '仅 Agent 可以访问任务 API');
  if (!user.agentId) throw new HttpError(403, 'JWT 缺少 agentId');
  return user.agentId;
}

// ─── GET /api/agent-tasks — Inbox ────────────────────────────

agentTasksRouter.get('/', asyncHandler(async (req, res) => {
  const agentId = requireAgent(req as any);

  const status = req.query.status as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

  const tasks = await rt.findInboxTasks({
    assigneeAgentId: agentId,
    status,
    limit,
  });

  res.json({ tasks });
}));

// ─── POST /api/agent-tasks/:taskId/claim — Atomic claim ─────

agentTasksRouter.post('/:taskId/claim', asyncHandler(async (req, res) => {
  const agentId = requireAgent(req as any);
  const taskId = req.params.taskId;

  const task = await rt.claimTask(taskId, agentId);
  if (!task) {
    // Check if task exists but doesn't belong to this agent
    const existing = await rt.findReviewTaskById(taskId);
    if (!existing) {
      throw new HttpError(404, 'Task not found');
    }
    if (existing.assigneeAgentId !== agentId) {
      throw new HttpError(403, 'Cannot claim a task assigned to another agent');
    }
    throw new HttpError(409, 'Task cannot be claimed — already completed, failed, cancelled, or lease still active');
  }

  res.json({ task });
}));

// ─── GET /api/agent-tasks/:taskId — Task detail with context ──

agentTasksRouter.get('/:taskId', asyncHandler(async (req, res) => {
  const agentId = requireAgent(req as any);
  const taskId = req.params.taskId;

  const context = await rt.buildTaskContext(taskId);
  if (!context) throw new HttpError(404, 'Task not found');

  // Cross-agent isolation
  if (context.task.assigneeAgentId !== agentId) {
    throw new HttpError(404, 'Task not found');
  }

  res.json(context);
}));

// ─── POST /api/agent-tasks/:taskId/complete — Complete + message ──

const ALLOWED_KINDS = ['comment', 'proposal', 'challenge', 'clarification', 'evidence', 'decision'];

agentTasksRouter.post('/:taskId/complete', asyncHandler(async (req, res) => {
  const agentId = requireAgent(req as any);
  const taskId = req.params.taskId;

  const { content, kind, mentions } = req.body;

  if (!content || !content.trim()) {
    throw new HttpError(400, 'content is required');
  }
  if (content.length > 50000) {
    throw new HttpError(400, 'content exceeds 50000 character limit');
  }

  const resolvedKind = kind || 'comment';
  if (!ALLOWED_KINDS.includes(resolvedKind)) {
    throw new HttpError(400, `kind must be one of: ${ALLOWED_KINDS.join(', ')}`);
  }

  // Get author name
  const task = await rt.findReviewTaskById(taskId);
  if (!task) throw new HttpError(404, 'Task not found');
  if (task.assigneeAgentId !== agentId) {
    throw new HttpError(404, 'Task not found');
  }

  const authorName = req.user!.name || agentId;

  const result = await rt.completeTaskWithMessage(
    taskId,
    agentId,
    content.trim(),
    resolvedKind,
    mentions || [],
    authorName,
  );

  if (!result) {
    throw new HttpError(409, 'Task cannot be completed — not claimed, lease expired, or already completed');
  }

  res.status(201).json({
    task: result.task,
    message: result.message,
  });
}));

// ─── POST /api/agent-tasks/:taskId/fail — Mark failed ────────

agentTasksRouter.post('/:taskId/fail', asyncHandler(async (req, res) => {
  const agentId = requireAgent(req as any);
  const taskId = req.params.taskId;

  const { error } = req.body;
  if (!error || !error.trim()) {
    throw new HttpError(400, 'error description is required');
  }
  if (error.length > 2000) {
    throw new HttpError(400, 'error exceeds 2000 character limit');
  }

  // Basic sanitization — reject stack traces or tokens
  if (error.includes('Bearer ') || error.includes('Authorization:') || error.includes('stack trace')) {
    throw new HttpError(400, 'error must not contain credentials or stack traces');
  }

  const task = await rt.findReviewTaskById(taskId);
  if (!task) throw new HttpError(404, 'Task not found');
  if (task.assigneeAgentId !== agentId) {
    throw new HttpError(404, 'Task not found');
  }

  const succeeded = await rt.failTask(taskId, agentId, error.trim());
  if (!succeeded) {
    throw new HttpError(409, 'Task cannot be failed — not claimed or already completed');
  }

  res.json({ ok: true });
}));
