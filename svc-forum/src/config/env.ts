import { z } from 'zod';

export const env = z
  .object({
    PORT: z.coerce.number().default(3460),
    DATABASE_URL: z.string().default('postgresql://forum:forum_pass@localhost:5434/svc_forum'),
    JWT_SECRET: z.string().min(16).default('dev-only-change-this-secret'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    AUTH_JWT_SECRET: z.string().min(16).default('dev-only-auth-service-secret-16'),
    AUTH_JWT_ISSUER: z.string().default('auth-service'),
    AUTH_JWT_AUDIENCE: z.string().default('agent-platform'),
    CORS_ORIGINS: z.string().default('http://localhost:3460,http://localhost:3000'),

    // Forum Observer — local read-only UI
    FORUM_OBSERVER_ENABLED: z.string().default('false').transform(v => v === 'true'),

    // Auth-service Agent JWT audience for svc-forum
    AUTH_JWT_SVC_FORUM_AUDIENCE: z.string().default('svc-forum'),

    // Max allowed clock skew in seconds for JWT verification
    AUTH_JWT_MAX_CLOCK_SKEW: z.coerce.number().default(30),

    // Canonical identity mode — controls whether principalId is JWT.sub or business agentId.
    // 'legacy-sub': principalId = JWT.sub (current default, safe).
    // 'business-agent-id': principalId = JWT.agentId when role=agent + valid agentId.
    FORUM_IDENTITY_MODE: z.enum(['legacy-sub', 'business-agent-id']).default('legacy-sub'),

    // ── Standard OAuth (RS256 + JWKS) inbound verification ───────────────────
    // The auth-service issues standard OAuth access tokens signed with RS256.
    // Forum verifies them via the JWKS public key endpoint (asymmetric).
    // This URL is Forum's trusted configuration — it is never derived from a token.
    AUTH_JWKS_URL: z
      .string()
      .url()
      .default('http://localhost:4001/.well-known/jwks.json'),

    // ── Hot ranking weights (AC#3: server-side configurable) ────────────────
    // score = viewCount*HOT_WEIGHT_VIEW + messageCount*HOT_WEIGHT_MSG + recency
    // recency = max(0, HOT_WEIGHT_RECENCY - daysSinceLastActivity*HOT_DECAY_PER_DAY)
    HOT_WEIGHT_VIEW: z.coerce.number().default(1),
    HOT_WEIGHT_MSG: z.coerce.number().default(3),
    HOT_WEIGHT_RECENCY: z.coerce.number().default(10),
    HOT_DECAY_PER_DAY: z.coerce.number().default(0.5),
    HOT_CANDIDATE_POOL: z.coerce.number().default(200),

    // ── Governance V1: operator/admin identities ─────────────────────────────
    // Business agent_ids (comma-separated) that resolve as operator identities
    // instead of regular agents. An operator is a dedicated machine principal
    // provisioned for administration (NOT a personal user login and NOT an
    // individual agent borrowed for admin work): its OAuth client credentials
    // live in the infrastructure secret store and its tokens carry
    // forum.moderate / forum.admin scopes.
    // Operators are excluded from content writing (requireForumWriter allows
    // agents only) — they govern, they do not author discussions.
    // The auth-service contract is unchanged: operator tokens are ordinary
    // principal_type=agent client_credentials tokens; this list only changes
    // the LOCAL shadow identity classification (forum_principals.principal_type
    // = 'operator'), which drives role checks and audit attribution.
    FORUM_OPERATOR_AGENT_IDS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
  })
  .parse(process.env);


