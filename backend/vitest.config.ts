import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

if (existsSync('../.env')) process.loadEnvFile('../.env')

const testDbUrl = process.env.TEST_DATABASE_URL ?? ''
if (!/test/i.test(new URL(testDbUrl || 'mysql://x/').pathname)) {
  throw new Error(
    'TEST_DATABASE_URL must be set and its database name must contain "test" (tests wipe it).',
  )
}

export default defineConfig({
  test: {
    globalSetup: ['./src/test/global-setup.ts'],
    // Integration tests share one database, so files run one at a time.
    fileParallelism: false,
    env: { DATABASE_URL: testDbUrl, NODE_ENV: 'test' },
    testTimeout: 20_000,
  },
})
