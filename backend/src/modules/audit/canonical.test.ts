import { expect, test } from 'vitest'
import { canonicalJson } from './canonical.js'

test('sorts keys recursively so key order does not change the output', () => {
  expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 2 } })).toBe(
    canonicalJson({ a: { c: 2, d: [{ y: 2, z: 1 }] }, b: 1 }),
  )
  expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
})

test('serialises dates as ISO strings', () => {
  expect(canonicalJson({ at: new Date('2026-01-02T03:04:05.006Z') })).toBe(
    '{"at":"2026-01-02T03:04:05.006Z"}',
  )
})
