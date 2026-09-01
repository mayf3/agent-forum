/**
 * Canonical principal abstraction for Forum authentication.
 *
 * Separates the raw JWT claims (authSubjectId, businessAgentId, principalType)
 * from the resolved identity used at the application layer (principalId).
 *
 * LEGACY mode (default):  principalId = JWT.sub
 * BUSINESS mode (flag ON): principalId = JWT.agentId  (when role=agent + valid agentId)
 *
 * PR-3A addition: recognizes `principal_type` claim from agent tokens.
 * Agent tokens set principalType from `principal_type` claim rather than `role` claim.
 */

// ── Types ───────────────────────────────────────────────────

// 'operator' is a LOCAL classification only: a dedicated machine principal
// (configured via FORUM_OPERATOR_AGENT_IDS) that administers the forum.
// Inbound JWTs are unchanged (principal_type=agent, standard OAuth) — the
// auth-service contract is not modified. The local shadow record and req.user
// role carry 'operator' so content-writing guards can exclude it.
export type PrincipalType = 'agent' | 'user' | 'service' | 'operator';
export type IdentityMode = 'legacy-sub' | 'business-agent-id';
export type AuthSource = 'auth_service_agent_jwt' | 'auth_service_jwt' | 'adc_jwt' | 'adc_legacy';

export interface ForumPrincipal {
  /** Raw JWT.sub — always present after auth. */
  authSubjectId: string;
  /** JWT.agentId claim, if present.  Undefined when missing or empty. */
  businessAgentId?: string;
  /** Resolved principal identifier used as req.user.id and for DB writes. */
  principalId: string;
  /** Whether this principal represents an agent or a human user. */
  principalType: PrincipalType;
  /** JWT issuer (iss claim). */
  issuer: string;
  /** Which identity resolution mode produced this principal. */
  identityMode: IdentityMode;
}

// ── AgentId validation ──────────────────────────────────────

const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/;

/**
 * Returns true when `value` is a syntactically valid business agentId.
 * Rejects empty strings, values with uppercase, and values longer than 128 chars.
 */
export function isValidAgentId(value: string): boolean {
  return AGENT_ID_PATTERN.test(value);
}

// ── UUID validation ─────────────────────────────────────────

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Strict UUID v4 validation.
 */
export function isValidUUID(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// ── Normalization ───────────────────────────────────────────

interface JwtLikePayload {
  sub?: string;
  agentId?: string;
  agent_id?: string;  // PR-3A: agent token uses snake_case
  role?: string;
  iss?: string;
  principal_type?: string;  // PR-3A: agent token claim
}

/**
 * Normalize a JWT payload into a canonical ForumPrincipal.
 *
 * PR-3A changes:
 * - Checks `principal_type` claim first (agent tokens). When present and === 'agent',
 *   principalType is set to 'agent' regardless of the `role` claim.
 * - Reads `agent_id` (snake_case, from agent tokens) as fallback if `agentId` not present.
 *
 * When `identityMode` is `'business-agent-id'` and the caller is an agent
 * with a valid agentId, the principalId becomes the business agentId.
 * In all other cases principalId stays as JWT.sub.
 *
 * This function is pure — no I/O, no side effects.
 */
export function normalizePrincipal(
  payload: JwtLikePayload,
  identityMode: IdentityMode,
): ForumPrincipal {
  const authSubjectId = payload.sub || '';
  // Accept both camelCase (human JWT) and snake_case (agent JWT)
  const businessAgentId = payload.agentId || payload.agent_id;
  const issuer = payload.iss || '';
  const role = payload.role || '';
  const principalTypeClaim = payload.principal_type;

  let principalId = authSubjectId;
  let principalType: PrincipalType = 'user';
  let resolvedMode: IdentityMode = 'legacy-sub';

  // PR-3A: Check principal_type claim from agent tokens.
  // When principal_type is explicitly set, use it directly.
  // When absent (legacy/human JWTs), preserve backward compat behavior
  // where principalType is only set to 'agent' inside the business mode block below.
  if (principalTypeClaim === 'agent') {
    principalType = 'agent';
  } else if (principalTypeClaim === 'user') {
    principalType = 'user';
  } else if (principalTypeClaim === 'service') {
    principalType = 'service';
  }
  // If principal_type is absent, fall through to existing role-based logic below.

  // Business agent-id mode resolution
  if (
    identityMode === 'business-agent-id' &&
    (principalType === 'agent' || role === 'agent') &&
    typeof businessAgentId === 'string' &&
    businessAgentId.trim().length > 0 &&
    isValidAgentId(businessAgentId)
  ) {
    principalId = businessAgentId;
    principalType = 'agent';
    resolvedMode = 'business-agent-id';
  }

  return {
    authSubjectId,
    businessAgentId: (typeof businessAgentId === 'string' && businessAgentId.trim().length > 0)
      ? businessAgentId
      : undefined,
    principalId,
    principalType,
    issuer,
    identityMode: resolvedMode,
  };
}
