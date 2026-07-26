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

    // Identity dry-run tool database URLs (read-only, never written).
    FORUM_DATABASE_URL: z.string().default('postgresql://forum:forum_pass@localhost:5434/svc_forum'),
    ADC_DATABASE_URL: z.string().optional(),
  })
  .parse(process.env);
