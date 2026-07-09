/**
 * Minimal Agent HTTP client.
 *
 * Calls a remote agent HTTP endpoint to get a reply for a discussion run step.
 * The agent receives the current transcript and returns content + kind.
 *
 * TODO: Production — replace with authenticated service-to-service call
 *       (mTLS / signed assertion / auth-service token exchange).
 */

import { env } from '../config/env.js';

export interface AgentRequest {
  threadId: string;
  runId: string;
  stepId: string;
  agentId: string;
  agentName: string;
  instruction?: string;
  transcriptMd: string;
  contextSnapshots: Array<{ title: string; excerptMd?: string | null }>;
  maxTokens: number;
}

export interface AgentResponse {
  content: string;
  kind?: string;
  mentions?: string[];
}

const ALLOWED_KINDS = [
  'comment', 'proposal', 'challenge', 'clarification',
  'evidence', 'decision', 'system',
];

/**
 * Call an agent's HTTP endpoint to get a forum reply.
 * Returns the agent's response or throws on failure.
 */
export async function callAgentReply(
  endpointUrl: string,
  request: AgentRequest,
  timeoutMs: number = env.AGENT_REPLY_TIMEOUT_MS,
): Promise<AgentResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Agent endpoint returned ${res.status}: ${body.slice(0, 500)}`
      );
    }

    const data: AgentResponse = await res.json();

    if (!data.content || !data.content.trim()) {
      throw new Error('Agent returned empty content');
    }

    if (data.kind && !ALLOWED_KINDS.includes(data.kind)) {
      throw new Error(`Agent returned invalid kind: "${data.kind}"`);
    }

    return {
      content: data.content.trim(),
      kind: data.kind || 'comment',
      mentions: data.mentions || [],
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Agent endpoint timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
