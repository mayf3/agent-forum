/**
 * Discussion Runner — executes a DiscussionRun by calling agent endpoints
 * in participantOrder sequence, then writing results as forum messages.
 *
 * MVP implementation: synchronous within the request lifecycle.
 * In production this should be async (job queue / worker).
 *
 * Messages are written directly via data-access layer, preserving the
 * intended agent identity. The dev-only JWT mint helper (agent-auth.ts)
 * exists for external callers who need to authenticate as an agent;
 * the runner bypasses HTTP to avoid circular self-calls.
 */
import * as runsDb from './discussion-runs-data.js';
import * as da from './data-access.js';
import { callAgentReply } from './agent-client.js';

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
  return null;
}

/**
 * Execute a full discussion run synchronously.
 * Iterates steps in seq order, calls agent endpoints, writes messages.
 */
export async function executeRun(runId: string): Promise<void> {
  // Mark run as running
  await runsDb.updateRun(runId, {
    status: 'running',
    startedAt: new Date(),
  });

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

  for (const step of steps) {
    await runsDb.updateStep(step.id, {
      status: 'running',
      startedAt: new Date(),
    });

    try {
      // 1. Build current transcript
      const threadId = run.threadId;
      const transcriptMd = (await da.buildTranscriptMd(threadId)) || '';
      const snapshots = await da.findSnapshotsByThreadId(threadId);

      // 2. Get agent endpoint
      const endpoints = (run.agentEndpoints || {}) as Record<string, string>;
      const endpointUrl = endpoints[step.agentId];
      if (!endpointUrl) {
        throw new Error(`No endpoint configured for agent "${step.agentId}"`);
      }

      // 3. Call agent
      const agentRequest = {
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

      await runsDb.updateStep(step.id, { invokedAt: new Date() });
      const agentResponse = await callAgentReply(endpointUrl, agentRequest);

      // 4. Write forum message directly via data-access
      // The runner is an internal module that has permission to write messages
      // on behalf of agents. External callers use JWT auth (agent-auth.ts).
      const message = await da.createMessage({
        threadId,
        authorId: step.agentId,
        authorName: step.agentName,
        authorType: 'agent',
        kind: agentResponse.kind || 'comment',
        content: agentResponse.content,
        mentions: agentResponse.mentions || [],
      });

      // 5. Mark step succeeded
      await runsDb.updateStep(step.id, {
        status: 'succeeded',
        resultMessageId: message.id,
        respondedAt: new Date(),
        finishedAt: new Date(),
      });
    } catch (err: any) {
      allSucceeded = false;
      firstError = err.message || 'Unknown error';

      await runsDb.updateStep(step.id, {
        status: 'failed',
        failureReason: err.message || 'Step failed',
        errorDetail: err.stack || undefined,
        finishedAt: new Date(),
      });

      // Stop on first failure
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
