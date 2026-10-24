import { z } from 'zod'

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    BACKEND_PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().startsWith('mysql://'),
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    CORS_ORIGIN: z.url(),
    SMTP_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
    MAIL_FROM: z.string().default('E-Voting <no-reply@example.com>'),
    AI_SERVICE_URL: z.url().default('http://localhost:8001'),
    AI_SERVICE_TOKEN: z.string().min(32, 'must be at least 32 characters'),
    FACE_ENCRYPTION_KEY: z
      .string()
      .transform((v) => Buffer.from(v, 'base64'))
      .refine((key) => key.length === 32, 'must be 32 bytes, base64-encoded'),
    // WebAuthn: the RP ID is the site's domain (never an IP); origins are where the frontend runs.
    WEBAUTHN_RP_ID: z.string().min(1).default('localhost'),
    WEBAUTHN_RP_NAME: z.string().min(1).default('Smart E-Voting'),
    WEBAUTHN_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((v) => v.split(',').map((o) => o.trim()))
      .pipe(z.array(z.url()).min(1)),
    // Express "trust proxy": which hops may set X-Forwarded-For (dev: the Vite proxy on loopback).
    TRUST_PROXY: z.string().default('loopback'),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.SMTP_URL, {
    message: 'SMTP_URL is required in production',
    path: ['SMTP_URL'],
  })

export type Config = z.infer<typeof envSchema>

/** Fails fast at startup with every invalid variable listed, rather than misbehaving later. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}
