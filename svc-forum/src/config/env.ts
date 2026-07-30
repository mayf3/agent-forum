import { z } from 'zod';

const FORUM_STRICT_AUTH_ENUM = z.enum(['true', 'false']);

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

    // Discussion Runner
    ENABLE_DEV_AGENT_JWT_MINT: z.string().default('false').transform(v => v === 'true'),
    AGENT_REPLY_TIMEOUT_MS: z.coerce.number().default(30000),

    // Auth service integration
    AUTH_SERVICE_URL: z.string().default('http://localhost:3457'),
    AGENT_AUTH_MODE: z.enum(['auth-service-token-login', 'dev-jwt']).default('auth-service-token-login'),

    // Agent endpoint allowlist (comma-separated URL patterns, e.g. "http://127.0.0.1:5001/*,http://127.0.0.1:5002/*")
    // Default allows common local dev ports. Set to empty to deny all remote endpoints.
    ALLOWED_AGENT_ENDPOINT_PATTERNS: z.string().default('http://127.0.0.1:5001/*,http://127.0.0.1:5002/*,http://localhost:5001/*,http://localhost:5002/*'),

    // ─── Forum Token Strict Auth ──────────────────────────────────────────
    // Must be explicitly set to 'true' in production. Any other value (including
    // typo like 'ture', 'yes', '1') causes zod parse failure at startup.
    FORUM_STRICT_AUTH: FORUM_STRICT_AUTH_ENUM.default('false'),

    // Signing key version identifier for key rotation awareness.
    // Should match auth-service's FORUM_SIGNING_KEY_VERSION in production.
    FORUM_SIGNING_KEY_VERSION: z.string().min(1).default('0'),
  })
  .superRefine((data, ctx) => {
    const isStrict = data.NODE_ENV === 'production' || data.FORUM_STRICT_AUTH === 'true';

    if (isStrict) {
      // In strict mode, AUTH_JWT_SECRET, AUTH_JWT_ISSUER, and AUTH_JWT_AUDIENCE
      // must be set to non-default values — failing fast at startup.
      if (!data.AUTH_JWT_SECRET || data.AUTH_JWT_SECRET === 'dev-only-auth-service-secret-16') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'FORUM_STRICT_AUTH: AUTH_JWT_SECRET must be set to a non-default value',
          path: ['AUTH_JWT_SECRET'],
        });
      }
      if (!data.AUTH_JWT_ISSUER || data.AUTH_JWT_ISSUER !== 'auth-service') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'FORUM_STRICT_AUTH: AUTH_JWT_ISSUER must be set to "auth-service"',
          path: ['AUTH_JWT_ISSUER'],
        });
      }
      if (!data.AUTH_JWT_AUDIENCE || data.AUTH_JWT_AUDIENCE !== 'svc-forum') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'FORUM_STRICT_AUTH: AUTH_JWT_AUDIENCE must be set to "svc-forum"',
          path: ['AUTH_JWT_AUDIENCE'],
        });
      }
    }

    // Warn if signing key version is the default '0' in production
    if (data.NODE_ENV === 'production' && data.FORUM_SIGNING_KEY_VERSION === '0') {
      console.warn(
        '[WARN] FORUM_SIGNING_KEY_VERSION is "0" (default). ' +
        'Set it to match auth-service FORUM_SIGNING_KEY_VERSION for key rotation awareness.',
      );
    }
  })
  .parse(process.env);

/**
 * Determines whether the forum operates in strict auth mode.
 * Production always uses strict auth; development/test can opt in via FORUM_STRICT_AUTH=true.
 */
export const strictAuth: boolean = env.NODE_ENV === 'production' || env.FORUM_STRICT_AUTH === 'true';
