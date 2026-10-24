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
