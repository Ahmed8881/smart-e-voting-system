import { expect, test } from 'vitest'
import { loadConfig } from './config.js'

test('applies defaults', () => {
  expect(loadConfig({})).toEqual({ NODE_ENV: 'development', BACKEND_PORT: 4000 })
})

test('rejects an invalid port with a readable message', () => {
  expect(() => loadConfig({ BACKEND_PORT: 'abc' })).toThrow(/BACKEND_PORT/)
})
