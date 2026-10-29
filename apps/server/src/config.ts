import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().default(4317),
  WEB_ORIGIN: z.string().default('http://localhost:5317'),
  PUBLIC_APP_URL: z.string().default('http://localhost:5317'),
  CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  STREAM_TOKEN_SECRET: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(168),
  COMMAND_TIMEOUT_MS: z.coerce.number().int().min(500).max(120000).default(10000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
  ALLOW_PRIVATE_INTEGRATION_HOSTS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;
const isProd = env.NODE_ENV === 'production';

function requireSecret(name: string, value: string | undefined, bytes: number, encoding: 'base64' | 'hex'): Buffer {
  if (value) {
    const buf = Buffer.from(value, encoding);
    if (buf.length !== bytes) throw new Error(`${name} must be ${bytes} bytes (${encoding}).`);
    return buf;
  }
  if (isProd) throw new Error(`${name} must be set in production.`);
  // Development/test fallback: ephemeral key. Credentials encrypted with it
  // cannot be decrypted after a restart, so integrations will ask to re-authenticate.
  // eslint-disable-next-line no-console
  console.warn(`[config] ${name} not set — using an ephemeral development key. Set it in .env to persist integration credentials.`);
  return randomBytes(bytes);
}

export const config = {
  env: env.NODE_ENV,
  isProd,
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  webOrigins: env.WEB_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  publicAppUrl: env.PUBLIC_APP_URL.replace(/\/$/, ''),
  credentialKey: requireSecret('CREDENTIAL_ENCRYPTION_KEY', env.CREDENTIAL_ENCRYPTION_KEY, 32, 'base64'),
  streamTokenSecret: requireSecret('STREAM_TOKEN_SECRET', env.STREAM_TOKEN_SECRET, 32, 'hex'),
  sessionTtlMs: env.SESSION_TTL_HOURS * 3600_000,
  commandTimeoutMs: env.COMMAND_TIMEOUT_MS,
  logLevel: env.LOG_LEVEL,
  allowPrivateIntegrationHosts: env.ALLOW_PRIVATE_INTEGRATION_HOSTS,
  sessionCookie: isProd ? '__Host-smartnest_session' : 'smartnest_session',
  /** Sensitive actions require password re-entry within this window */
  reauthWindowMs: 5 * 60_000,
} as const;
