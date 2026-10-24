import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
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
