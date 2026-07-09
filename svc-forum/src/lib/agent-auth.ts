/**
 * Dev-only agent JWT mint helper.
 *
 * In production, agents would authenticate via auth-service token-login or
 * service-to-service authorization. This helper exists only for local
 * development and smoke testing — it should NEVER be enabled in production.
 *
 * TODO: Production — replace with auth-service token-login or
 *       service-to-service (mTLS / signed-assertion) authorization.
 */

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AgentTokenPayload {
  sub: string;
  name: string;
  role: string;
}

const VALID_KINDS = [
  'comment', 'proposal', 'challenge', 'clarification',
  'evidence', 'decision', 'system',
] as const;

export type MessageKind = typeof VALID_KINDS[number];

export function isValidKind(kind: string): kind is MessageKind {
  return VALID_KINDS.includes(kind as MessageKind);
}

/**
 * Mint a dev-only JWT for an agent.
 * Only works when ENABLE_DEV_AGENT_JWT_MINT=true.
 * Throws if the flag is not set.
 */
export function mintAgentJwt(agentId: string, agentName: string): string {
  if (!env.ENABLE_DEV_AGENT_JWT_MINT) {
    throw new Error(
      'ENABLE_DEV_AGENT_JWT_MINT is not enabled. ' +
      'This is a dev-only feature. In production, use auth-service token-login.'
    );
  }

  const payload: AgentTokenPayload = {
    sub: agentId,
    name: agentName,
    role: 'agent',
  };

  return jwt.sign(payload, env.JWT_SECRET);
}
