import { expect, test } from 'vitest'
import { loadConfig } from './config.js'

const valid = {
  DATABASE_URL: 'mysql://u:p@localhost:3306/db',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  CORS_ORIGIN: 'http://localhost:5173',
  AI_SERVICE_TOKEN: 't'.repeat(32),
  FACE_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
}

test('applies defaults', () => {
  const config = loadConfig(valid)
  expect(config.BACKEND_PORT).toBe(4000)
  expect(config.REFRESH_TOKEN_TTL_DAYS).toBe(7)
  expect(config.SMTP_URL).toBeUndefined()
})

test('rejects an invalid port with a readable message', () => {
  expect(() => loadConfig({ ...valid, BACKEND_PORT: 'abc' })).toThrow(/BACKEND_PORT/)
})

test('rejects a short JWT secret', () => {
  expect(() => loadConfig({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/)
})

test('requires SMTP in production', () => {
  expect(() => loadConfig({ ...valid, NODE_ENV: 'production', SMTP_URL: '' })).toThrow(/SMTP_URL/)
})

test('decodes the face encryption key and rejects the wrong length', () => {
  expect(loadConfig(valid).FACE_ENCRYPTION_KEY).toHaveLength(32)
  expect(() =>
    loadConfig({ ...valid, FACE_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
  ).toThrow(/FACE_ENCRYPTION_KEY/)
})
