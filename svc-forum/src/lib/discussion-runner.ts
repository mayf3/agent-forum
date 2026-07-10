/**
 * Discussion Runner — executes a DiscussionRun by calling agent endpoints
 * in participantOrder sequence, then writing results as forum messages.
 *
 * Supports both sync and async modes.
 * Async mode: POST /start returns immediately; worker processes steps in background.
 *
 * Messages are written directly via data-access layer, preserving the
 * intended agent identity.
 */
import * as runsDb from './discussion-runs-data.js';
import * as da from './data-access.js';
import { callAgentReply, type AgentRequest } from './agent-client.js';
import { getAgentAccessToken } from './agent-auth-service.js';
import { mintAgentJwt } from './agent-auth.js';
import { validateEndpoint } from './endpoint-allowlist.js';
import { env } from '../config/env.js';

const MAX_ROUNDS_LIMIT = 3;
const MAX_MESSAGES_LIMIT = 20;
const MAX_PARTICIPANT_ORDER_LENGTH = 10;

export function validateRunLimits(
  participantOrder: string[],
  maxRounds: number,
  maxMessages: number,
): string | null {
  if (!participantOrder || participantOrder.length === 0) {
    return 'participantOrder must not be empty';
  }
  if (participantOrder.length > MAX_PARTICIPANT_ORDER_LENGTH) {
    return `participantOrder length ${participantOrder.length} exceeds max ${MAX_PARTICIPANT_ORDER_LENGTH}`;
  }
  if (maxRounds < 1 || maxRounds > MAX_ROUNDS_LIMIT) {
    return `maxRounds must be between 1 and ${MAX_ROUNDS_LIMIT}`;
  }
  if (maxMessages < 1 || maxMessages > MAX_MESSAGES_LIMIT) {
    return `maxMessages must be between 1 and ${MAX_MESSAGES_LIMIT}`;
  }
  const totalSteps = participantOrder.length * maxRounds;
  if (totalSteps > maxMessages) {
    return `participantOrder.length (${participantOrder.length}) × maxRounds (${maxRounds}) = ${totalSteps} exceeds maxMessages (${maxMessages})`;
  }
  return null;
}

// ── Async Worker ──

let workerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the discussion run worker polling loop.
 * Checks for claimed-but-not-completed runs periodically.
 */
export function startDiscussionRunWorker(intervalMs: number = 2000): void {
  if (workerInterval) return;
  workerInterval = setInterval(() => {
    // In MVP, runs are executed via setImmediate from the start handler.
    // This worker is a safety net for runs that might have been queued
    // but not picked up (e.g., after process restart).
    // For now this is a no-op placeholder.
  }, intervalMs);
}

/**
 * Stop the discussion run worker.
 */
export function stopDiscussionRunWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}

/**
 * Execute a claimed run's steps (called asynchronously via setImmediate).
 * Can also be called directly in tests for deterministic execution.
 */
export async function executeClaimedRun(runId: string): Promise<void> {
  const steps = await runsDb.findStepsByRunId(runId);
  if (steps.length === 0) {
    await runsDb.updateRun(runId, {
      status: 'failed',
      failureReason: 'No steps to execute',
      finishedAt: new Date(),
    });
    return;
  }

  const run = await runsDb.findRunById(runId);
  if (!run) return;

  let allSucceeded = true;
  let firstError: string | null = null;

  // Load agent auth tokens if present
  const agentAuthTokens = (run.agentAuthTokens || {}) as Record<string, string>;
  const authMode = run.authMode || env.AGENT_AUTH_MODE;

  for (const step of steps) {
    // Skip already-succeeded steps (idempotent resume)
    if (step.status === 'succeeded') continue;

    await runsDb.updateStep(step.id, {
      status: 'running',
      startedAt: new Date(),
    });

    try {
      const threadId = run.threadId;
      const transcriptMd = (await da.buildTranscriptMd(threadId)) || '';
      const snapshots = await da.findSnapshotsByThreadId(threadId);

      // Get agent endpoint
      const endpoints = (run.agentEndpoints || {}) as Record<string, string>;
      const endpointUrl = endpoints[step.agentId];
      if (!endpointUrl) {
        throw new Error(`No endpoint configured for agent "${step.agentId}"`);
      }

      // Validate endpoint at execution time as well
      const epValidation = validateEndpoint(endpointUrl);
      if (!epValidation.valid) {
        throw new Error(`Endpoint validation failed at runtime for ${step.agentId}: ${epValidation.reason}`);
      }

      // Build agent request
      const agentRequest: AgentRequest = {
        protocolVersion: 'v1',
        threadId,
        runId,
        stepId: step.id,
        agentId: step.agentId,
        agentName: step.agentName,
        instruction: step.instruction || undefined,
        transcriptMd,
        contextSnapshots: snapshots.map((s) => ({
          title: s.title,
          excerptMd: s.excerptMd,
        })),
        maxTokens: 800,
      };

      // Obtain access token for the agent
      let accessToken: string | undefined;

      if (authMode === 'auth-service-token-login') {
        // Use pre-signed token from run creation (stored in agentAuthTokens)
        const preSignedToken = agentAuthTokens[step.agentId];
        if (!preSignedToken) {
          throw new Error(`No pre-signed token available for agent "${step.agentId}"`);
        }
        accessToken = await getAgentAccessToken({
          agentId: step.agentId,
          agentName: step.agentName,
          preSignedToken,
        });
      } else if (authMode === 'dev-jwt') {
        // Dev-only fallback: mint JWT locally
        accessToken = mintAgentJwt(step.agentId, step.agentName);
      }

      await runsDb.updateStep(step.id, { invokedAt: new Date() });
      const agentResponse = await callAgentReply(endpointUrl, agentRequest, accessToken);

      // Atomically write message + mark step succeeded
      await runsDb.recordStepAndMessage(
        runId,
        step.id,
        step.seq,
        threadId,
        step.agentId,
        step.agentName,
        agentResponse.kind || 'comment',
        agentResponse.content,
        agentResponse.mentions || [],
      );
    } catch (err: any) {
      allSucceeded = false;
      firstError = err.message || 'Unknown error';

      await runsDb.markStepFailed(
        runId,
        step.id,
        err.message || 'Step failed',
        err.stack || undefined,
      );

      break;
    }
  }

  // Mark run complete
  await runsDb.updateRun(runId, {
    status: allSucceeded ? 'succeeded' : 'failed',
    failureReason: allSucceeded ? null : firstError,
    finishedAt: new Date(),
  });
}

/**
 * Legacy sync executeRun — kept for backward compat.
 * Delegates to executeClaimedRun.
 */
export async function executeRun(runId: string): Promise<void> {
  return executeClaimedRun(runId);
}

/**
 * Enqueue a run for async execution.
 * Returns immediately; worker processes in background.
 */
export function enqueueRun(runId: string): void {
  setImmediate(() => {
    executeClaimedRun(runId).catch((err) => {
      console.error(`[runner] Failed to execute run ${runId}:`, err?.message);
    });
  });
}
