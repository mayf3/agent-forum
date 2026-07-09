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

    // Discussion Runner
    ENABLE_DEV_AGENT_JWT_MINT: z.string().default('true').transform(v => v === 'true'),
    AGENT_REPLY_TIMEOUT_MS: z.coerce.number().default(30000),
  })
  .parse(process.env);
